'use strict';

const semver = require('semver');
const request = require('request');

const meta = require('../meta');

let versionCache = '';
let versionCacheLastModified = '';

const isPrerelease = /^v?\d+\.\d+\.\d+-.+$/;

var temp = true;

function getLatestVersion(callback) {
	// do not pull latest version from github
	if (temp) {
		return callback(null, 'v1.12.2');
	}
	var headers = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': encodeURIComponent('NodeBB Admin Control Panel/' + meta.config.title),
	};

	if (versionCacheLastModified) {
		headers['If-Modified-Since'] = versionCacheLastModified;
	}

	request('https://api.github.com/repos/NodeBB/NodeBB/tags', {
		json: true,
		headers: headers,
		timeout: 1000,
	}, function (err, res, releases) {
		if (err) {
			return callback(err);
		}

		if (res.statusCode === 304) {
			return callback(null, versionCache);
		}

		if (res.statusCode !== 200) {
			return callback(Error(res.statusMessage));
		}

		releases = releases.filter(function (version) {
			return !isPrerelease.test(version.name);	// filter out automated prerelease versions
		}).map(function (version) {
			return version.name.replace(/^v/, '');
		}).sort(function (a, b) {
			return semver.lt(a, b) ? 1 : -1;
		});

		versionCache = releases[0];
		versionCacheLastModified = res.headers['last-modified'];

		callback(null, versionCache);
	});
}

exports.getLatestVersion = getLatestVersion;
exports.isPrerelease = isPrerelease;

require('../promisify')(exports);
