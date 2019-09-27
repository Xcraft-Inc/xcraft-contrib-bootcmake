'use strict';

var path = require('path');
const fs = require('fs');
var async = require('async');

var xPlatform = require('xcraft-core-platform');
var xFs = require('xcraft-core-fs');
var xEnv = require('xcraft-core-env');

var cmd = {};

exports.getGenerator = function() {
  switch (xPlatform.getOs()) {
    case 'win': {
      return 'MinGW Makefiles';
    }
    default: {
      return 'Unix Makefiles';
    }
  }
};

exports.getMakeTool = function() {
  switch (xPlatform.getOs()) {
    case 'win': {
      return 'mingw32-make';
    }
    default: {
      return 'make';
    }
  }
};

exports.stripShForMinGW = function() {
  const list = [];

  if (xPlatform.getOs() !== 'win') {
    return list;
  }

  /* Strip MSYS from the PATH. */
  while (true) {
    const sh = xEnv.var.path.isIn('sh.exe');
    if (!sh) {
      break;
    }

    list.push({
      index: sh.index,
      location: xEnv.var.path.strip(sh.index),
    });
  }

  return list;
};

var getJobs = function(force) {
  var os = require('os');

  if (!force && xPlatform.getOs() === 'win') {
    return 1;
  }

  return os.cpus().length;
};

/* TODO: must be generic. */
var makeRun = function(makeDir, make, jobs, resp, callback) {
  resp.log.info('begin building of cmake');

  var list = ['all', 'install'];

  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    parser: 'cmake',
    resp,
  });

  var currentDir = process.cwd();
  process.chdir(makeDir);
  async.eachSeries(
    list,
    function(args, callback) {
      var fullArgs = ['-j' + getJobs(jobs)].concat(args);

      xProcess.spawn(make, fullArgs, {}, function(err) {
        callback(err ? 'make failed: ' + err : null);
      });
    },
    function(err) {
      if (!err) {
        resp.log.info('cmake is built and installed');
      }

      process.chdir(currentDir);
      callback(err ? 'make failed' : null);
    }
  );
};

/* TODO: must be generic. */
var bootstrapRun = function(cmakeDir, resp, callback) {
  const pkgConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-bootcmake'
  );

  /* FIXME, TODO: use a backend (a module) for building cmake. */
  /* bootstrap --prefix=/mingw && make && make install */
  var args = [
    `--prefix=${path.resolve(pkgConfig.out)}`,
    `--parallel=${getJobs()}`,
    '--',
    "-DCMAKE_CXX_FLAGS_RELEASE='-O2 -g0 -march=native -mtune=native'",
    '-DCMAKE_BUILD_TYPE=Release',
  ];

  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    parser: 'cmake',
    resp,
  });

  var currentDir = process.cwd();
  process.chdir(cmakeDir);
  fs.chmodSync('./bootstrap', 0o755);
  xProcess.spawn('./bootstrap', args, {}, function(err) {
    process.chdir(currentDir);
    callback(err ? 'bootstrap failed: ' + err : null);
  });
};

/* TODO: must be generic. */
var cmakeRun = function(srcDir, resp, callback) {
  const pkgConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-bootcmake'
  );

  /* FIXME, TODO: use a backend (a module) for building with cmake. */
  /* cmake -DCMAKE_INSTALL_PREFIX:PATH=/usr . && make all install */

  var buildDir = path.join(srcDir, '../BUILD_CMAKE');
  xFs.mkdir(buildDir);

  var args = [
    "-DCMAKE_CXX_FLAGS_RELEASE='-O2 -g0 -march=native -mtune=native'",
    '-DCMAKE_COLOR_MAKEFILE=OFF',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_INSTALL_PREFIX:PATH=' + path.resolve(pkgConfig.out),
    srcDir,
  ];

  args.unshift('-G', exports.getGenerator());

  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    parser: 'cmake',
    resp,
  });

  var currentDir = process.cwd();
  process.chdir(buildDir);
  xProcess.spawn('cmake', args, {}, function(err) {
    process.chdir(currentDir);
    callback(err ? 'cmake failed: ' + err : null);
  });
};

var patchRun = function(srcDir, resp, callback) {
  var xDevel = require('xcraft-core-devel');
  var async = require('async');

  var os = xPlatform.getOs();

  var patchDir = path.join(__dirname, 'patch');
  var list = xFs.ls(patchDir, new RegExp('^([0-9]+|' + os + '-).*.patch$'));

  if (!list.length) {
    callback();
    return;
  }

  async.eachSeries(
    list,
    function(file, callback) {
      resp.log.info('apply patch: ' + file);
      var patchFile = path.join(patchDir, file);

      xDevel.patch(srcDir, patchFile, 1, resp, function(err) {
        callback(err ? 'patch failed: ' + file + ' ' + err : null);
      });
    },
    function(err) {
      callback(err);
    }
  );
};

/**
 * Build the cmake package.
 */
cmd.build = function(msg, resp) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  const pkgConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-bootcmake'
  );

  var archive = path.basename(pkgConfig.src);
  var inputFile = pkgConfig.src;
  var outputFile = path.join(xcraftConfig.tempRoot, 'src', archive);

  async.auto(
    {
      taskHttp: function(callback) {
        var xHttp = require('xcraft-core-http');

        xHttp.get(
          inputFile,
          outputFile,
          function() {
            callback();
          },
          function(progress, total) {
            resp.log.progress('Downloading', progress, total);
          }
        );
      },

      taskExtract: [
        'taskHttp',
        function(callback) {
          var xExtract = require('xcraft-core-extract');
          var outDir = path.dirname(outputFile);

          xExtract.targz(
            outputFile,
            outDir,
            null,
            resp,
            function(err) {
              callback(
                err ? 'extract failed: ' + err : null,
                path.join(outDir, path.basename(outputFile, '.tar.gz'))
              );
            },
            function(progress, total) {
              resp.log.progress('Extracting', progress, total);
            }
          );
        },
      ],

      taskPatch: [
        'taskExtract',
        function(callback, results) {
          patchRun(results.taskExtract, resp, callback);
        },
      ],

      taskPrepare: [
        'taskPatch',
        function(callback) {
          // FIXME: disable build via CMake, we should remove this code
          var cmake = false; // xEnv.var.path.isIn('cmake' + xPlatform.getExecExt());
          callback(null, cmake);
        },
      ],

      taskBootstrap: [
        'taskPrepare',
        function(callback, results) {
          if (!results.taskPrepare) {
            bootstrapRun(results.taskExtract, resp, callback);
          } else {
            callback();
          }
        },
      ],

      taskMSYS: [
        'taskPrepare',
        function(callback, results) {
          var res = {
            cmake: null,
            path: null,
          };

          if (!results.taskPrepare) {
            res.cmake = false;
            callback(null, res);
            return;
          }

          res.cmake = true;
          res.path = exports.stripShForMinGW();

          callback(null, res);
        },
      ],

      taskCMake: [
        'taskMSYS',
        function(callback, results) {
          if (results.taskMSYS.cmake) {
            cmakeRun(results.taskExtract, resp, callback);
          } else {
            callback();
          }
        },
      ],

      taskMake: [
        'taskBootstrap',
        'taskCMake',
        function(callback, results) {
          var buildDir = results.taskMSYS.cmake
            ? path.join(results.taskExtract, '../BUILD_CMAKE')
            : results.taskExtract;
          makeRun(
            buildDir,
            results.taskMSYS.cmake ? exports.getMakeTool() : 'make',
            results.taskMSYS.cmake,
            resp,
            callback
          );
        },
      ],
    },
    function(err, results) {
      if (err) {
        resp.log.err(err);
      }

      /* Restore MSYS path. */
      if (results.taskMSYS && results.taskMSYS.path) {
        for (const p of results.taskMSYS.path) {
          xEnv.var.path.insert(p.index, p.location);
        }
      }

      resp.events.send(`cmake.build.${msg.id}.finished`);
    }
  );
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function() {
  return {
    handlers: cmd,
    rc: {
      build: {
        desc: 'build and install CMake',
      },
    },
  };
};
