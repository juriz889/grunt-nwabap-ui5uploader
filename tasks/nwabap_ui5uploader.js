/*
 * grunt-nwabap-ui5uploader
 * https://github.com/pfefferf/grunt-nwabap-ui5uploader
 *
 * Copyright (c) 2018 Florian Pfeffer
 * Licensed under the Apache-2.0 license.
 */

'use strict';

var FileStore = require('./lib/filestore.js');
var Transports = require('./lib/transports');
var Logger = require('./lib/logger.js');

module.exports = function (grunt) {

    grunt.registerMultiTask('nwabap_ui5uploader_custom', 'UI5 source upload to SAP NetWeaver ABAP', function () {

        var done = this.async();

        var oOptions = this.options({
            resources: {}
        });

        if (!oOptions.ui5.language) {
            oOptions.ui5.language = 'EN';
        }

        if (!oOptions.conn.hasOwnProperty('useStrictSSL')) {
            oOptions.conn.useStrictSSL = true;
        }

        // checks
        if (!oOptions.resources || !oOptions.resources.cwd || !oOptions.resources.src) {
            grunt.fail.warn('"resources" option not (fully) specified.');
            done();
            return;
        }

        if (typeof oOptions.resources === 'object' && oOptions.resources instanceof Array) {
            grunt.fail.warn('"resources" option must not be an array.');
            done();
            return;
        }

        if (!oOptions.auth || !oOptions.auth.user || !oOptions.auth.pwd) {
            grunt.fail.warn('"auth" option not (fully) specified (check user name and password).');
            done();
            return;
        }

        if (!oOptions.ui5 || !oOptions.ui5.package || !oOptions.ui5.bspcontainer || !oOptions.ui5.bspcontainer_text) {
            grunt.fail.warn('"ui5" option not (fully) specified (check package, BSP container, BSP container text information).');
            done();
            return;
        }

        if (oOptions.ui5.package !== '$TMP' && !oOptions.ui5.transportno && oOptions.ui5.create_transport !== true && oOptions.ui5.transport_use_locked !== true) {
            grunt.fail.warn('For packages <> "$TMP" a transport number is necessary.');
            done();
            return;
        }

        if (oOptions.ui5.create_transport === true && typeof oOptions.ui5.transport_text !== 'string') {
            grunt.fail.warn('Please specifiy a description to be used for the created transport in option "ui5.transport_text".');
            done();
            return;
        }

        var bspcontainerExclNamespace = oOptions.ui5.bspcontainer.substring(oOptions.ui5.bspcontainer.lastIndexOf('/') + 1);
        if (bspcontainerExclNamespace.length > 15) {
            grunt.fail.warn('"ui5.bspcontainer" option must not be longer than 15 characters (exclusive customer specific namespace e.g. /YYY/.');
            done();
            return;
        }

        // log options
        grunt.verbose.writeln('Options: ' + JSON.stringify(oOptions));

        // get file names
        var aFiles = [];

        grunt.file.expand({
            cwd: oOptions.resources.cwd,
            filter: 'isFile',
            dot: true
        }, oOptions.resources.src).forEach(function (sFile) {
            aFiles.push(sFile);
        });

        // log found files
        grunt.verbose.writeln('Files: ' + aFiles);

        var oFileStoreOptions = {
            conn: {
                server: oOptions.conn.server,
                client: oOptions.conn.client,
                useStrictSSL: oOptions.conn.useStrictSSL
            },
            auth: {
                user: oOptions.auth.user,
                pwd: oOptions.auth.pwd
            },
            ui5: {
                language: oOptions.ui5.language.toUpperCase(),
                transportno: oOptions.ui5.transportno,
                package: oOptions.ui5.package,
                bspcontainer: oOptions.ui5.bspcontainer,
                bspcontainer_text: oOptions.ui5.bspcontainer_text,
                transport_use_user_match: !!oOptions.ui5.transport_use_user_match,
                transport_use_locked: !!oOptions.ui5.transport_use_locked,
                calc_appindex: !!oOptions.ui5.calc_appindex
            }
        };

        var oLogger = new Logger(grunt);

        /**
         *
         * @param {object} oFileStoreOptions
         * @param {object} oLogger
         * @param {object} aFiles
         * @param {object} oOptions
         */
        function syncFiles(oFileStoreOptions, oLogger, aFiles, oOptions) {
            var oFileStore = new FileStore(oFileStoreOptions, oLogger);
            oFileStore.syncFiles(aFiles, oOptions.resources.cwd, function (oError, aArtifactsSync) {
                if (oError) {
                    grunt.fail.warn(oError);
                }

                done();
            });
        }

        /**
         * @description Uploads the files with an transports which does the user own.
         * @param {Object} oTransportManager - Transport manager
         */
        function uploadWithTransportUserMatch(oTransportManager) {
            oTransportManager.determineExistingTransport(oOptions.ui5.transport_text, function (oError, sTransportNo) {
                if (sTransportNo) {
                    oFileStoreOptions.ui5.transportno = sTransportNo;
                    syncFiles(oFileStoreOptions, oLogger, aFiles, oOptions);
                } else if (oOptions.ui5.create_transport === true) {
                    oTransportManager.createTransport(oOptions.ui5.package, oOptions.ui5.transport_text, function (oError, sTransportNo) {
                        if (oError) {
                            grunt.fail.fatal(oError);
                            return done();
                        }
                        oFileStoreOptions.ui5.transportno = sTransportNo;
                        syncFiles(oFileStoreOptions, oLogger, aFiles, oOptions);
                    });
                } else {
                    oError = new Error('No transport found and create transport was disabled!');
                    grunt.fail.fatal(oError);
                    return done();
                }
            });
        }
        /**
         * @description Ends grunt task in case of an error
         * @param {Object} oError - Error object
         */
        function _endGrundIfErrorIsBound(oError) {
            if (oError) {
                grunt.fail.fatal(oError);
                done();
            }
        }
        /**
         * @description In case grunt option is set it will create a new transport and sync the files
         * @param {Object} oTransportManager - Transport manager
         */
        function createNewTransportAndSyncIfAllowed(oTransportManager) {
            if (oOptions.ui5.create_transport === true) {
                oTransportManager.createTransport(oOptions.ui5.package, oOptions.ui5.transport_text, function (oError, sTransportNo) {
                    _endGrundIfErrorIsBound(oError);
                    oFileStoreOptions.ui5.transportno = sTransportNo;
                    syncFiles(oFileStoreOptions, oLogger, aFiles, oOptions);
                });
            } else {
                var oError = new Error('No transport configured but create transport and user match was disabled!');
                _endGrundIfErrorIsBound(oError);
            }
        }
        /**
         * @description Will check if the application is already locked in a task. If this is the case the corresponting transport will be used.
         * In case no lock was found this function will call the create new tranport and sync function
         * @param {Object} oTransportManager - Transport manager
         */
        function checkExistingTranportAndSync(oTransportManager) {
            oTransportManager.checkExistingTransport(oOptions.ui5.package, oOptions.ui5.bspcontainer, function (oError, oTransportCheck) {
                _endGrundIfErrorIsBound(oError);
                if (oTransportCheck.successful) {
                    if (oTransportCheck.transportNo) {
                        oFileStoreOptions.ui5.transportno = oTransportCheck.transportNo;
                        syncFiles(oFileStoreOptions, oLogger, aFiles, oOptions);
                    } else {
                        createNewTransportAndSyncIfAllowed(oTransportManager);
                    }
                } else {
                    grunt.fail.warn('Could not successfully check existing transport lock');
                    done();
                }
            });
        }
        if (oOptions.ui5.package !== '$TMP' && oOptions.ui5.transportno === undefined) {
            var oTransportManager = new Transports(oFileStoreOptions, oLogger);
            if (oOptions.ui5.transport_use_locked) {
                checkExistingTranportAndSync(oTransportManager);
            } else if (oOptions.ui5.transport_use_user_match) {
                uploadWithTransportUserMatch(oTransportManager);
            } else {
                createNewTransportAndSyncIfAllowed(oTransportManager);
            }
        } else {
            syncFiles(oFileStoreOptions, oLogger, aFiles, oOptions);
        }
    });

};
