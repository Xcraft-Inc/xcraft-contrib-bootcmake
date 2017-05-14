'use strict';

var path = require ('path');
var async = require ('async');

var xPlatform = require ('xcraft-core-platform');
var xFs = require ('xcraft-core-fs');
var xEnv = require ('xcraft-core-env');

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
  const list = [];

  if (xPlatform.getOs () !== 'win') {
    return list;
  }

  /* Strip MSYS from the PATH. */
  while (true) {
    const sh = xEnv.var.path.isIn ('sh.exe');
    if (!sh) {
      break;
    }

    list.push ({
      index: sh.index,
      location: xEnv.var.path.strip (sh.index),
    });
  }

  return list;
};

var getJobs = function (force) {
  var os = require ('os');

  if (!force && xPlatform.getOs () === 'win') {
    return 1;
  }

  return os.cpus ().length;
};

/* TODO: must be generic. */
var makeRun = function (makeDir, make, jobs, response, callback) {
  response.log.info ('begin building of cmake');

  var list = ['all', 'install'];

  const xProcess = require ('xcraft-core-process') ({
    logger: 'xlog',
    parser: 'cmake',
    resp: response,
  });

  var currentDir = process.cwd ();
  process.chdir (makeDir);
  async.eachSeries (
    list,
    function (args, callback) {
      var fullArgs = ['-j' + getJobs (jobs)].concat (args);

      xProcess.spawn (make, fullArgs, {}, function (err) {
        callback (err ? 'make failed: ' + err : null);
      });
    },
    function (err) {
      if (!err) {
        response.log.info ('cmake is built and installed');
      }

      process.chdir (currentDir);
      callback (err ? 'make failed' : null);
    }
  );
};

/* TODO: must be generic. */
var bootstrapRun = function (cmakeDir, response, callback) {
  const pkgConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft-contrib-bootcmake'
  );

  /* FIXME, TODO: use a backend (a module) for building cmake. */
  /* bootstrap --prefix=/mingw && make && make install */
  var args = [
    'bootstrap',
    '--parallel=' + getJobs (),
    '--prefix=' + path.resolve (pkgConfig.out),
  ];

  const xProcess = require ('xcraft-core-process') ({
    logger: 'xlog',
    parser: 'cmake',
    resp: response,
  });

  var currentDir = process.cwd ();
  process.chdir (cmakeDir);
  xProcess.spawn ('sh', args, {}, function (err) {
    process.chdir (currentDir);
    callback (err ? 'bootstrap failed: ' + err : null);
  });
};

/* TODO: must be generic. */
var cmakeRun = function (srcDir, response, callback) {
  const pkgConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft-contrib-bootcmake'
  );

  /* FIXME, TODO: use a backend (a module) for building with cmake. */
  /* cmake -DCMAKE_INSTALL_PREFIX:PATH=/usr . && make all install */

  var buildDir = path.join (srcDir, '../BUILD_CMAKE');
  xFs.mkdir (buildDir);

  var args = [
    '-DCMAKE_COLOR_MAKEFILE=OFF',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_INSTALL_PREFIX:PATH=' + path.resolve (pkgConfig.out),
    srcDir,
  ];

  args.unshift ('-G', exports.getGenerator ());

  const xProcess = require ('xcraft-core-process') ({
    logger: 'xlog',
    parser: 'cmake',
    resp: response,
  });

  var currentDir = process.cwd ();
  process.chdir (buildDir);
  xProcess.spawn ('cmake', args, {}, function (err) {
    process.chdir (currentDir);
    callback (err ? 'cmake failed: ' + err : null);
  });
};

var patchRun = function (srcDir, response, callback) {
  var xDevel = require ('xcraft-core-devel');
  var async = require ('async');

  var os = xPlatform.getOs ();

  var patchDir = path.join (__dirname, 'patch');
  var list = xFs.ls (patchDir, new RegExp ('^([0-9]+|' + os + '-).*.patch$'));

  if (!list.length) {
    callback ();
    return;
  }

  async.eachSeries (
    list,
    function (file, callback) {
      response.log.info ('apply patch: ' + file);
      var patchFile = path.join (patchDir, file);

      xDevel.patch (srcDir, patchFile, 1, response, function (err) {
        callback (err ? 'patch failed: ' + file + ' ' + err : null);
      });
    },
    function (err) {
      callback (err);
    }
  );
};

/**
 * Build the cmake package.
 */
cmd.build = function (msg, response) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft'
  );
  const pkgConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft-contrib-bootcmake'
  );

  var archive = path.basename (pkgConfig.src);
  var inputFile = pkgConfig.src;
  var outputFile = path.join (xcraftConfig.tempRoot, 'src', archive);

  async.auto (
    {
      taskHttp: function (callback) {
        var xHttp = require ('xcraft-core-http');

        xHttp.get (
          inputFile,
          outputFile,
          function () {
            callback ();
          },
          function (progress, total) {
            response.log.progress ('Downloading', progress, total);
          }
        );
      },

      taskExtract: [
        'taskHttp',
        function (callback) {
          var xExtract = require ('xcraft-core-extract');
          var outDir = path.dirname (outputFile);

          xExtract.targz (
            outputFile,
            outDir,
            null,
            response,
            function (err) {
              callback (
                err ? 'extract failed: ' + err : null,
                path.join (outDir, path.basename (outputFile, '.tar.gz'))
              );
            },
            function (progress, total) {
              response.log.progress ('Extracting', progress, total);
            }
          );
        },
      ],

      taskPatch: [
        'taskExtract',
        function (callback, results) {
          patchRun (results.taskExtract, response, callback);
        },
      ],

      taskPrepare: [
        'taskPatch',
        function (callback) {
          var cmake = xEnv.var.path.isIn ('cmake' + xPlatform.getExecExt ());
          callback (null, cmake);
        },
      ],

      taskBootstrap: [
        'taskPrepare',
        function (callback, results) {
          if (!results.taskPrepare) {
            bootstrapRun (results.taskExtract, response, callback);
          } else {
            callback ();
          }
        },
      ],

      taskMSYS: [
        'taskPrepare',
        function (callback, results) {
          var res = {
            cmake: null,
            path: null,
          };

          if (!results.taskPrepare) {
            res.cmake = false;
            callback (null, res);
            return;
          }

          res.cmake = true;
          res.path = exports.stripShForMinGW ();

          callback (null, res);
        },
      ],

      taskCMake: [
        'taskMSYS',
        function (callback, results) {
          if (results.taskMSYS.cmake) {
            cmakeRun (results.taskExtract, response, callback);
          } else {
            callback ();
          }
        },
      ],

      taskMake: [
        'taskBootstrap',
        'taskCMake',
        function (callback, results) {
          var buildDir = results.taskMSYS.cmake
            ? path.join (results.taskExtract, '../BUILD_CMAKE')
            : results.taskExtract;
          makeRun (
            buildDir,
            results.taskMSYS.cmake ? exports.getMakeTool () : 'make',
            results.taskMSYS.cmake,
            response,
            callback
          );
        },
      ],
    },
    function (err, results) {
      if (err) {
        response.log.err (err);
      }

      /* Restore MSYS path. */
      if (results.taskMSYS && results.taskMSYS.path) {
        for (const p of results.taskMSYS.path) {
          xEnv.var.path.insert (p.index, p.location);
        }
      }

      response.events.send ('cmake.build.finished');
    }
  );
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: {
      build: {
        desc: 'build and install CMake',
      },
    },
  };
};
