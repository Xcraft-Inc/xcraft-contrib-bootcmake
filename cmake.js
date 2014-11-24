'use strict';

var moduleName = 'cmake';

var path  = require ('path');
var async = require ('async');

var xProcess     = require ('xcraft-core-process');
var xPlatform    = require ('xcraft-core-platform');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var xLog         = require ('xcraft-core-log') (moduleName);
var xFs          = require ('xcraft-core-fs');
var busClient    = require ('xcraft-core-busclient');

var pkgConfig = require ('xcraft-core-etc').load ('xcraft-contrib-cmake');
var cmd = {};


var getJobs = function (force) {
  var os = require ('os');

  if (!force && xPlatform.getOs () === 'win') {
    return 1;
  }

  return os.cpus ().length;
};

/* TODO: must be generic. */
var makeRun = function (make, jobs, callback) {
  xLog.info ('begin building of cmake');

  var list = [
    'all',
    'install'
  ];

  async.eachSeries (list, function (args, callback) {
    var fullArgs = ['-j' + getJobs (jobs)].concat (args);

    xProcess.spawn (make, fullArgs, function (err) {
      callback (err ? 'make failed: ' + err : null);
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
  xProcess.spawn ('sh', args, function (err) {
    callback (err ? 'bootstrap failed: ' + err : null);
  }, function (line) {
    xLog.verb (line);
  }, function (line) {
    xLog.warn (line);
  });
};

/* TODO: must be generic. */
var cmakeRun = function (srcDir, callback) {
  /* FIXME, TODO: use a backend (a module) for building with cmake. */
  /* cmake -DCMAKE_INSTALL_PREFIX:PATH=/usr . && make all install */

  var buildDir = path.join (srcDir, '../BUILD_CMAKE');
  xFs.mkdir (buildDir);

  var args = [
    '-DCMAKE_INSTALL_PREFIX:PATH=' + path.resolve (pkgConfig.out),
    srcDir
  ];

  if (xPlatform.getOs () === 'win') {
    args.unshift ('-G', 'MinGW Makefiles');
  }

  process.chdir (buildDir);
  xProcess.spawn ('cmake', args, function (err) {
    callback (err ? 'cmake failed: ' + err : null);
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
  var xPath = require ('xcraft-core-path');

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

    taskPrepare: ['taskExtract', function (callback) {
      var cmake = xPath.isIn ('cmake' + xPlatform.getExecExt ());
      callback (null, cmake);
    }],

    taskBootstrap: ['taskPrepare', function (callback, results) {
      if (!results.taskPrepare) {
        bootstrapRun (results.taskExtract, callback);
      } else {
        callback ();
      }
    }],

    taskMSYS: ['taskPrepare', function (callback, results) {
      if (!results.taskPrepare) {
        callback (null, [false, null]);
        return;
      }

      if (xPlatform.getOs () === 'win') {
        /* Remove MSYS from the path. */
        var sh = xPath.isIn ('sh.exe');
        if (sh) {
          var paths = process.env.PATH;
          var list = paths.split (path.delimiter);
          list.splice (sh.index, 1);
          process.env.PATH = list.join (path.delimiter);
          xLog.verb ('drop MSYS from PATH: ' + process.env.PATH);
          callback (null, [true, paths]);
          return;
        }
      }
      callback (null, [true, null]);
    }],

    taskCMake: ['taskMSYS', function (callback, results) {
      if (results.taskMSYS[0]) {
        cmakeRun (results.taskExtract, callback);
      } else {
        callback ();
      }
    }],

    taskMake: ['taskBootstrap', 'taskCMake', function (callback, results) {
      makeRun (results.taskMSYS[0] && xPlatform.getOs () === 'win' ? 'mingw32-make' : 'make',
               results.taskMSYS[0],
               callback);
    }]
  }, function (err, results) {
    if (err) {
      xLog.err (err);
    }

    /* Restore MSYS */
    if (results.taskMSYS[0]) {
      xLog.verb ('restore PATH: ' + results.taskMSYS[1]);
      process.env.PATH = results.taskMSYS[1];
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
      desc   : rc[action] ? rc[action].desc    : null,
      options: rc[action] ? rc[action].options : {},
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
