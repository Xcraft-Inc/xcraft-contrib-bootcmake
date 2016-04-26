'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc.
 */
module.exports = [{
  type: 'input',
  name: 'name',
  message: 'package name',
  default: 'cmake'
}, {
  type: 'input',
  name: 'version',
  message: 'version',
  default: '3.5.2'
}, {
  type: 'input',
  name: 'src',
  message: 'source URI',
  default: 'http://www.cmake.org/files/v3.5/cmake-3.5.2.tar.gz'
}, {
  type: 'input',
  name: 'out',
  message: 'output directory',
  default: './usr'
}];
