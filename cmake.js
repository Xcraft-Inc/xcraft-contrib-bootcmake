'use strict';

var moduleName = 'cmake';

var path  = require ('path');
var async = require ('async');

var xProcess     = require ('xcraft-core-process');
var xPlatform    = require ('xcraft-core-platform');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var xLog         = require ('xcraft-core-log') (moduleName);
var busClient    = require ('xcraft-core-busclient');

var pkgConfig = require ('xcraft-core-etc').load ('xcraft-contrib-cmake');
var cmd = {};


var getJobs = function () {
  var os = require ('os');

  if (xPlatform.getOs () === 'win') {
    return 1;
  }

  return os.cpus ().length;
};

/* TODO: must be generic. */
var makeRun = function (callback) {
  xLog.info ('begin building of cmake');

  var list = [
    'all',
    'install'
  ];

  async.eachSeries (list, function (args, callback) {
    var fullArgs = ['-j' + getJobs ()].concat (args);

    xProcess.spawn ('make', fullArgs, function (done) {
      callback (done ? null : 'make failed');
    }, function (line) {
      xLog.verb (line);
    }, function (line) {
      xLog.warn (line);
    });
  }, function (err) {
    if (!err) {
      xLog.info ('cmake is built and installed');
    }

    callback (err ? 'make failed' : null);
  });
};

/* TODO: must be generic. */
var bootstrapRun = function (cmakeDir, callback) {
  /* FIXME, TODO: use a backend (a module) for building cmake. */
  /* bootstrap --prefix=/mingw && make && make install */
  var args = [
    'bootstrap',
    '--parallel=' + getJobs (),
    '--prefix=' + path.resolve (pkgConfig.out)
  ];

  process.chdir (cmakeDir);
  xProcess.spawn ('sh', args, function (done) {
    callback (done ? null : 'bootstrap failed');
  }, function (line) {
    xLog.verb (line);
  }, function (line) {
    xLog.warn (line);
  });
};

/**
 * Install the cmake package.
 */
cmd.install = function () {
  var archive = path.basename (pkgConfig.src);
  var inputFile  = pkgConfig.src;
  var outputFile = path.join (xcraftConfig.tempRoot, 'src', archive);

  async.auto (
  {
    taskHttp: function (callback) {
      var xHttp = require ('xcraft-core-http');

      xHttp.get (inputFile, outputFile, function () {
        callback ();
      });
    },

    taskExtract: ['taskHttp', function (callback) {
      var xExtract = require ('xcraft-core-extract');
      var outDir = path.dirname (outputFile);

      xExtract.targz (outputFile, outDir, null, function (err) {
        callback (err ? 'extract failed: ' + err : null,
                  path.join (outDir, path.basename (outputFile, '.tar.gz')));
      });
    }],

    taskBootstrap: ['taskExtract', function (callback, results) {
      bootstrapRun (results.taskExtract, callback);
    }],

    taskMake: ['taskBootstrap', makeRun]
  }, function (err) {
    if (err) {
      xLog.err (err);
    }

    busClient.events.send ('cmake.install.finished');
  });
};

/**
 * Uninstall the cmake package.
 */
cmd.uninstall = function () {
  xLog.warn ('the uninstall action is not implemented');
  busClient.events.send ('cmake.uninstall.finished');
};

/**
 * Retrieve the list of available commands.
 * @returns {Object[]} The list of commands.
 */
exports.xcraftCommands = function () {
  var utils  = require ('xcraft-core-utils');
  var rcFile = path.join (__dirname, './rc.json');
  var rc     = utils.jsonFile2Json (rcFile);
  var list   = [];

  Object.keys (cmd).forEach (function (action) {
    list.push ({
      name   : action,
      desc   : rc[action] ? rc[action].desc   : null,
      params : rc[action] ? rc[action].params : null,
      handler: cmd[action]
    });
  });

  return list;
};

/**
 * Retrieve the inquirer definition for xcraft-core-etc.
 */
exports.xcraftConfig = [{
  type: 'input',
  name: 'name',
  message: 'package name',
  default: 'cmake'
}, {
  type: 'input',
  name: 'version',
  message: 'version',
  default: '3.0.2'
}, {
  type: 'input',
  name: 'src',
  message: 'source URI',
  default: 'http://www.cmake.org/files/v3.0/cmake-3.0.2.tar.gz'
}, {
  type: 'input',
  name: 'out',
  message: 'output directory',
  default: './usr'
}];
