'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const winston = require('winston');

const { createCanvas } = require('canvas');
const file = require('./file');
const plugins = require('./plugins');
const meta = require('./meta');

const canvas = createCanvas(200, 200);
const ctx = canvas.getContext('2d');

const image = module.exports;

function measureText(str, fontSize = 10) {
	ctx.font = fontSize + 'px solid';
	return ctx.measureText(str).width;
}

function getNewText(text, fontSize, maxWidth) {
	const ellipsis = '...';
	while (measureText(text + ellipsis, fontSize) >= maxWidth - (fontSize * 2)) {
		text = text.substr(0, text.length - 1);
	}
	return text + ellipsis;
}

async function watermark(filePath, newFilePath, text) {
	const sharp = requireSharp();
	const png = sharp(filePath);
	const info = await png.metadata();
	const fontSize = Math.ceil(info.width / 48);
	const width = measureText(text, fontSize);
	if (width > info.width) {
		text = getNewText(text.substr(0, text.length - 4), fontSize, info.width);
	}

	const svg = `
        <svg width="${info.width}" height="${fontSize * 1.5}">
            <g style="overflow:hidden; text-anchor: middle; font-size: ${fontSize}px;">
                <defs>
                    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="10 10" result="glow"/>
                        <feMerge>
                            <feMergeNode in="glow"/>
                        </feMerge>
                    </filter>
                </defs>
                <text y="${fontSize}" style="filter: url(#glow); fill: black;"  x="50%">${text}</text>
                <text y="${fontSize}" style="fill: white;" x="50%" fill-opacity="0.8">${text}</text>
            </g>
        </svg>
        `;
	const watermark = Buffer.from(svg);
	await png
		.composite([{ input: watermark, gravity: 'south' }])
		.sharpen()
		.withMetadata()
		.toFile(newFilePath);
}

function requireSharp() {
	const sharp = require('sharp');
	if (os.platform() === 'win32') {
		// https://github.com/lovell/sharp/issues/1259
		sharp.cache(false);
	}
	return sharp;
}

image.isFileTypeAllowed = async function (path) {
	const plugins = require('./plugins');
	if (plugins.hasListeners('filter:image.isFileTypeAllowed')) {
		return await plugins.fireHook('filter:image.isFileTypeAllowed', path);
	}
	const sharp = require('sharp');
	await sharp(path, {
		failOnError: true,
	}).metadata();
};

image.resizeImage = async function (data) {
	if (plugins.hasListeners('filter:image.resize')) {
		await plugins.fireHook('filter:image.resize', {
			path: data.path,
			target: data.target,
			width: data.width,
			height: data.height,
			quality: data.quality,
		});
	} else {
		const sharp = requireSharp();
		const buffer = await fs.promises.readFile(data.path);
		const sharpImage = sharp(buffer, {
			failOnError: true,
		});
		const metadata = await sharpImage.metadata();

		sharpImage.rotate(); // auto-orients based on exif data
		sharpImage.resize(data.hasOwnProperty('width') ? data.width : null, data.hasOwnProperty('height') ? data.height : null);

		if (data.quality && metadata.format === 'jpeg') {
			sharpImage.jpeg({ quality: data.quality });
		}

		await sharpImage.toFile(data.target || data.path);
	}
};

image.normalise = async function (path) {
	if (plugins.hasListeners('filter:image.normalise')) {
		await plugins.fireHook('filter:image.normalise', {
			path: path,
		});
	} else {
		const sharp = requireSharp();
		await sharp(path, { failOnError: true }).png().toFile(path + '.png');
	}
	return path + '.png';
};

image.size = async function (path) {
	let imageData;
	if (plugins.hasListeners('filter:image.size')) {
		imageData = await plugins.fireHook('filter:image.size', {
			path: path,
		});
	} else {
		const sharp = requireSharp();
		imageData = await sharp(path, { failOnError: true }).metadata();
	}
	return imageData ? { width: imageData.width, height: imageData.height } : undefined;
};

image.stripEXIF = async function (path) {
	if (!meta.config.stripEXIFData || path.endsWith('.gif')) {
		return;
	}
	try {
		const buffer = await fs.promises.readFile(path);
		const sharp = requireSharp();
		await sharp(buffer, { failOnError: true }).rotate().toFile(path);
	} catch (err) {
		winston.error(err.stack);
	}
};

image.checkDimensions = async function (path) {
	const meta = require('./meta');
	const result = await image.size(path);

	if (result.width > meta.config.rejectImageWidth || result.height > meta.config.rejectImageHeight) {
		throw new Error('[[error:invalid-image-dimensions]]');
	}
};

image.convertImageToBase64 = async function (path) {
	return await fs.promises.readFile(path, 'base64');
};

image.mimeFromBase64 = function (imageData) {
	return imageData.slice(5, imageData.indexOf('base64') - 1);
};

image.extensionFromBase64 = function (imageData) {
	return file.typeToExtension(image.mimeFromBase64(imageData));
};

image.writeImageDataToTempFile = async function (imageData) {
	const filename = crypto.createHash('md5').update(imageData).digest('hex');

	const type = image.mimeFromBase64(imageData);
	const extension = file.typeToExtension(type);

	const filepath = path.join(os.tmpdir(), filename + extension);

	const buffer = Buffer.from(imageData.slice(imageData.indexOf('base64') + 7), 'base64');

	await fs.promises.writeFile(filepath, buffer, { encoding: 'base64' });
	return filepath;
};

image.sizeFromBase64 = function (imageData) {
	return Buffer.from(imageData.slice(imageData.indexOf('base64') + 7), 'base64').length;
};

image.uploadImage = async function (filename, folder, imageData) {
	if (plugins.hasListeners('filter:uploadImage')) {
		return await plugins.fireHook('filter:uploadImage', {
			image: imageData,
			uid: imageData.uid,
			folder: folder,
		});
	}
	await image.isFileTypeAllowed(imageData.path);
	const upload = await file.saveFileToLocal(filename, folder, imageData.path);
	return {
		url: upload.url,
		path: upload.path,
		name: imageData.name,
	};
};

image.addWatermark = async function (filePath, newFilePath, userName) {
	await watermark(filePath, newFilePath, '潮目@' + userName);
};

require('./promisify')(image);
