'use strict';

module.exports = {
    presets: [
        ['@babel/preset-env', {
            targets: { node: '4.8.0' }
        }]
    ],
    ignore: [
        // Add whitelisted modules to sped up builds
        '**/ajv/**',
        '**/mustache/**',
        '**/mkdirp/**',
        '**/fs-extra/**',
        '**/bin/**'
    ]
};
