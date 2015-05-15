'use strict';

var moduleName = 'cmake';

var path  = require ('path');
var async = require ('async');

var xProcess     = require ('xcraft-core-process') ({logger: 'xlog', mod: moduleName});
var xPlatform    = require ('xcraft-core-platform');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var xLog         = require ('xcraft-core-log') (moduleName);
var xFs          = require ('xcraft-core-fs');
var busClient    = require ('xcraft-core-busclient').global;

var pkgConfig = require ('xcraft-core-etc').load ('xcraft-contrib-cmake');
var cmd = {};


exports.getGenerator = function () {
  switch (xPlatform.getOs ()) {
  case 'win': {
    return 'MinGW Makefiles';
  }
  default: {
    return 'Unix Makefiles';
  }
  }
};

exports.getMakeTool = function () {
  switch (xPlatform.getOs ()) {
  case 'win': {
    return 'mingw32-make';
  }
  default: {
    return 'make';
  }
  }
};

exports.stripShForMinGW = function () {
  var xPath = require ('xcraft-core-path');

  if (xPlatform.getOs () !== 'win') {
    return null;
  }

  /* Strip MSYS from the PATH. */
  var sh = xPath.isIn ('sh.exe');
  return sh ? {
    index:    sh.index,
    location: xPath.strip (sh.index)
  } : null;
};

var getJobs = function (force) {
  var os = require ('os');

  if (!force && xPlatform.getOs () === 'win') {
    return 1;
  }

  return os.cpus ().length;
};

/* TODO: must be generic. */
var makeRun = function (makeDir, make, jobs, callback) {
  xLog.info ('begin building of cmake');

  var list = [
    'all',
    'install'
  ];

  var currentDir = process.cwd ();
  process.chdir (makeDir);
  async.eachSeries (list, function (args, callback) {
    var fullArgs = ['-j' + getJobs (jobs)].concat (args);

    xProcess.spawn (make, fullArgs, {}, function (err) {
      callback (err ? 'make failed: ' + err : null);
    });
  }, function (err) {
    if (!err) {
      xLog.info ('cmake is built and installed');
    }

    process.chdir (currentDir);
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

  var currentDir = process.cwd ();
  process.chdir (cmakeDir);
  xProcess.spawn ('sh', args, {}, function (err) {
    process.chdir (currentDir);
    callback (err ? 'bootstrap failed: ' + err : null);
  });
};

/* TODO: must be generic. */
var cmakeRun = function (srcDir, callback) {
  /* FIXME, TODO: use a backend (a module) for building with cmake. */
  /* cmake -DCMAKE_INSTALL_PREFIX:PATH=/usr . && make all install */

  var buildDir = path.join (srcDir, '../BUILD_CMAKE');
  xFs.mkdir (buildDir);

  var args = [
    '-DCMAKE_COLOR_MAKEFILE=OFF',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_INSTALL_PREFIX:PATH=' + path.resolve (pkgConfig.out),
    srcDir
  ];

  args.unshift ('-G', exports.getGenerator ());

  var currentDir = process.cwd ();
  process.chdir (buildDir);
  xProcess.spawn ('cmake', args, {}, function (err) {
    process.chdir (currentDir);
    callback (err ? 'cmake failed: ' + err : null);
  });
};

/**
 * Build the cmake package.
 */
cmd.build = function () {
  var xPath = require ('xcraft-core-path');

  var archive = path.basename (pkgConfig.src);
  var inputFile  = pkgConfig.src;
  var outputFile = path.join (xcraftConfig.tempRoot, 'src', archive);

  async.auto ({
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
      var res = {
        cmake: null,
        path: null
      };

      if (!results.taskPrepare) {
        res.cmake = false;
        callback (null, res);
        return;
      }

      res.cmake = true;
      res.path = exports.stripShForMinGW ();

      callback (null, res);
    }],

    taskCMake: ['taskMSYS', function (callback, results) {
      if (results.taskMSYS.cmake) {
        cmakeRun (results.taskExtract, callback);
      } else {
        callback ();
      }
    }],

    taskMake: ['taskBootstrap', 'taskCMake', function (callback, results) {
      var buildDir = results.taskMSYS.cmake ?
                     path.join (results.taskExtract, '../BUILD_CMAKE') :
                     results.taskExtract;
      makeRun (buildDir,
               results.taskMSYS.cmake ? exports.getMakeTool () : 'make',
               results.taskMSYS.cmake,
               callback);
    }]
  }, function (err, results) {
    if (err) {
      xLog.err (err);
    }

    /* Restore MSYS path. */
    if (results.taskMSYS.path) {
      xPath.insert (results.taskMSYS.path.index, results.taskMSYS.path.location);
    }

    busClient.events.send ('cmake.build.finished');
  });
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: path.join (__dirname, './rc.json')
  };
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
