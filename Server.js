const http = require('http');
const path = require('path');
const chalk = require('chalk');
const mime = require('mime');
const url = require('url');
const fs = require('fs');
const ejs = require('ejs');
const ws = require('socket.io');
const zlib = require('zlib');
const exec = require('child_process').exec;
const { stat, readdir } = require('./promisifiedFn');

const template = fs.readFileSync(path.join(__dirname, './template.html'), 'utf-8');

class Server {
  constructor(option = {}) {
    this.dir = option.dir;
    this.port = option.port;
    this.gzip = option.gzip;
    this.template = template;
    this.handleRequest = this.handleRequest.bind(this);
  }

  async handleRequest(req, res) {
    const { pathname } = url.parse(decodeURI(req.url));
    const currentPath = path.join(this.dir, pathname);
    try {
      const statObj = await stat(currentPath);
      if (statObj.isDirectory()) {
        const files = await readdir(currentPath);
        const promiseAry = files.map(file => {
          const absPath = path.join(currentPath, file);
          return new Promise((resolve, reject) => {
            fs.stat(absPath, (err, stats) => {
              if (stats.isDirectory()) {
                resolve({
                  type: 'dir',
                  name: file,
                  link: path.join(pathname, file)
                })
              } else {
                resolve({
                  type: mime.getType(absPath),
                  name: file,
                  link: path.join(pathname, file)
                })
              }
            })
          });
        });
        const fileList = await Promise.all(promiseAry);
        let renderResult = ejs.render(this.template, { fileList });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html;charset=utf-8');
        res.end(renderResult);
        this.startWatch(currentPath);
      } else {
        this.sendFile(req, res, currentPath, statObj);
      }
    } catch (err) {
      console.log(err);
      this.sendError(req, res, currentPath);
    }
  }

  startWatch(currentPath) {
    fs.watch(currentPath, 'utf8', (type) => {
      if (type === 'rename') {
        this.io.send('refresh');
      };
    })
  }

  sendError(req, res, currentPath) {
    res.statusCode = 404;
    res.end(`can not found ${currentPath}`);
  }

  isCache(req, res, statObj) {
    const ifModifiedSince = req.headers['if-modified-since'];
    const ifNoneMatch = req.headers['if-none-match'];
    const lastModified = statObj.cTime + '';
    const eTag = statObj.size + '';
    const expireTime = new Date(Date.now() + 180 * 1000);
    if (eTag === ifNoneMatch) {
      return true
    };
    if (lastModified === ifModifiedSince) {
      return true
    };
    res.setHeader('Cache-Control', 'max-age=180');
    res.setHeader('ETag', eTag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Expires', `${expireTime.toUTCString()}`);
    return false
  }

  sendFile(req, res, currentPath, statObj) {
    if (this.isCache(req, res, statObj)) {
      res.statusCode = 304;
      res.end();
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Type', `${mime.getType(currentPath)};charset=utf-8`);
      if(this.gzip){
        const gs = zlib.createGzip();
        const rs = fs.createReadStream(currentPath);
        res.setHeader('Content-Coding','gzip');
        rs.pipe(gs).pipe(res);
      } else {
        fs.createReadStream(currentPath).pipe(res);
      }
    }
  }

  start() {
    let server = http.createServer(this.handleRequest);
    this.io = ws(server);
    this.io.on('connection', (socket) => {
      socket.on('message', (msg) => {
        console.log(msg);
      })
    });
    server.listen(this.port, () => {
      console.log(chalk.green(`live server start at ${this.port}`))
    });
    switch (process.platform) {
      case 'darwin':
        exec(`open http://localhost:${this.port}`);
        break;
      case 'win32':
        exec(`start http://localhost:${this.port}`);
        break;
      default:
        exec(`xdg-open http://localhost:${this.port}`)
    }
  }
}

module.exports = Server