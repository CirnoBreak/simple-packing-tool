const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const babel = require('babel-core');

let ID = 0;

// 读取文件路径，提取依赖
function createAsset (filename) {
  // 以字符串形式读取文件内容
  const content = fs.readFileSync(filename, 'utf-8');

  // 解析AST
  const ast = babylon.parse(content, {
    sourceType: 'module'
  });

  // 存储模块依赖的相对路径
  const dependencies = [];

  // 遍历ast
  traverse(ast, {
    // 遍历import声明,比如 import message from './message.js'
    ImportDeclaration: ({ node }) => {
      // 存储import的来源，比如 './message.js'
      dependencies.push(node.source.value);
    }
  })

  // 模块标识符
  const id = ID++;

  // 转换,把语法转换成浏览器能运行的代码
  const { code } = babel.transformFromAst(ast, null, {
    presets: ['env'],
  });

  // 当前模块信息
  return {
    id,
    filename,
    dependencies,
    code
  }
}

// 从入口逐步提取模块依赖关系，组成'依赖图'
function createGraph (entry) {
  // 解析入口文件
  const mainAsset = createAsset(entry);
  // 依赖队列,用于解析依赖关系
  const queue = [mainAsset];
  
  // 遍历队列，但遍历过程中会有新的模块信息放入队列，须遍历至依赖寻找完成才停止
  for (const asset of queue) {
    // 获取目录名，此处返回 './example'
    const dirname = path.dirname(asset.filename);

    // 相对路径与id的映射关系
    asset.mapping = {};

    asset.dependencies.forEach((relativePath) => {
      // 引入模块对应的绝对路径
      const absolutePath = path.join(dirname, relativePath);
      
      // 继续寻找引入的模块
      const child = createAsset(absolutePath);

      // 把路径作为key，id作为value，来表示一一对应关系
      asset.mapping[relativePath] = child.id;

      // 存进遍历队列
      queue.push(child);
    });
  }

  return queue;
}

// 打包
function bundle (graph) {
  let modules = '';
  
  graph.forEach((mod) => {
    modules += `${mod.id}: [
      function (require, module, exports) {
        ${mod.code}
      },
      ${JSON.stringify(mod.mapping)}
    ],`;
  });

  /**
   * IIFE中的 `${modules}`为上述的模块集合
   * require函数接收模块id(从0开始)，并在module字符串里面的对象查找
   * modules[id]是由模块函数跟模块mapping关系组成的
   * 用require接收模块id，两个require可能相对路径一样，但实际上是两个模块，这时需要创建一个新的require
   * 通过localRequire把相对路径转成id
   * 最后在模块需要导出的时候，使用commonjs的exports来暴露模块
   */
  const result = `
    (function (modules) {
      function require (id) {
        const [fn, mapping] = modules[id];

        function localRequire (relativePath) {
          return require(mapping[relativePath]);
        }

        const module = {
          exports: {}
        };

        fn(localRequire, module, module.exports);

        return module.exports;
      }

      require(0);
    })({
      ${modules}
    })
  `;

  return result;
}

const graph = createGraph('./example/entry.js');
const result = bundle(graph);

console.log(result);