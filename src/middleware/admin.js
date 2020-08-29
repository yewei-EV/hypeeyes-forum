'use strict';

var winston = require('winston');
var jsesc = require('jsesc');
var nconf = require('nconf');
var semver = require('semver');

var user = require('../user');
var meta = require('../meta');
var plugins = require('../plugins');
var privileges = require('../privileges');
var utils = require('../../public/src/utils');
var versions = require('../admin/versions');
var helpers = require('./helpers');

var controllers = {
	api: require('../controllers/api'),
	helpers: require('../controllers/helpers'),
};

const middleware = module.exports;

middleware.buildHeader = helpers.try(async function (req, res, next) {
	res.locals.renderAdminHeader = true;
	res.locals.config = await controllers.api.loadConfig(req);
	next();
});

middleware.renderHeader = async (req, res, data) => {
	var custom_header = {
		plugins: [],
		authentication: [],
	};
	res.locals.config = res.locals.config || {};

	const results = await utils.promiseParallel({
		userData: user.getUserFields(req.uid, ['username', 'userslug', 'email', 'picture', 'email:confirmed']),
		scripts: getAdminScripts(),
		custom_header: plugins.fireHook('filter:admin.header.build', custom_header),
		configs: meta.configs.list(),
		latestVersion: getLatestVersion(),
		privileges: privileges.admin.get(req.uid),
	});

	var userData = results.userData;
	userData.uid = req.uid;
	userData['email:confirmed'] = userData['email:confirmed'] === 1;
	userData.privileges = results.privileges;

	var acpPath = req.path.slice(1).split('/');
	acpPath.forEach(function (path, i) {
		acpPath[i] = path.charAt(0).toUpperCase() + path.slice(1);
	});
	acpPath = acpPath.join(' > ');

	var version = nconf.get('version');

	res.locals.config.userLang = res.locals.config.acpLang || res.locals.config.userLang;
	var templateValues = {
		config: res.locals.config,
		configJSON: jsesc(JSON.stringify(res.locals.config), { isScriptContext: true }),
		relative_path: res.locals.config.relative_path,
		adminConfigJSON: encodeURIComponent(JSON.stringify(results.configs)),
		user: userData,
		userJSON: jsesc(JSON.stringify(userData), { isScriptContext: true }),
		plugins: results.custom_header.plugins,
		authentication: results.custom_header.authentication,
		scripts: results.scripts,
		'cache-buster': meta.config['cache-buster'] || '',
		env: !!process.env.NODE_ENV,
		title: (acpPath || 'Dashboard') + ' | NodeBB Admin Control Panel',
		bodyClass: data.bodyClass,
		version: version,
		latestVersion: results.latestVersion,
		upgradeAvailable: results.latestVersion && semver.gt(results.latestVersion, version),
		showManageMenu: results.privileges.superadmin || ['categories', 'privileges', 'users', 'settings'].some(priv => results.privileges[`admin:${priv}`]),
	};

	templateValues.template = { name: res.locals.template };
	templateValues.template[res.locals.template] = true;

	return await req.app.renderAsync('admin/header', templateValues);
};

async function getAdminScripts() {
	const scripts = await plugins.fireHook('filter:admin.scripts.get', []);
	return scripts.map(function (script) {
		return { src: script };
	});
}

async function getLatestVersion() {
	try {
		const result = await versions.getLatestVersion();
		return result;
	} catch (err) {
		winston.error('[acp] Failed to fetch latest version' + err.stack);
	}
	return null;
}

middleware.renderFooter = async function (req, res, data) {
	return await req.app.renderAsync('admin/footer', data);
};

middleware.checkPrivileges = async (req, res, next) => {
	// Kick out guests, obviously
	if (!req.uid) {
		return controllers.helpers.notAllowed(req, res);
	}

	// Users in "administrators" group are considered super admins
	const isAdmin = await user.isAdministrator(req.uid);
	if (isAdmin) {
		return next();
	}

	// Otherwise, check for privilege based on page (if not in mapping, deny access)
	const path = req.path.replace(/^(\/api)?\/admin\/?/g, '');
	if (path) {
		const privilege = privileges.admin.resolve(path);
		if (!privilege || !await privileges.admin.can(privilege, req.uid)) {
			return controllers.helpers.notAllowed(req, res);
		}
	} else {
		// If accessing /admin, check for any valid admin privs
		const privilegeSet = await privileges.admin.get(req.uid);
		if (!Object.values(privilegeSet).some(Boolean)) {
			return controllers.helpers.notAllowed(req, res);
		}
	}

	next();
};
