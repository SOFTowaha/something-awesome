const express = require('express');
const exphbs = require('express-handlebars');
const busboy = require('connect-busboy');
const path = require('path');
const bodyParser = require('body-parser');
const bytes = require('bytes');
const conf = require('./config.js');
const storage = require('./storage.js');

const notLocalHost = conf.notLocalHost;

const mozlog = require('./log.js');

const log = mozlog('portal.server');

const app = express();

app.engine('handlebars', exphbs({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');

app.use(busboy());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/exists/:id', (req, res) => {
  const id = req.params.id;
  storage.exists(id).then(doesExist => {
    res.sendStatus(doesExist ? 200 : 404);
  });
});

app.get('/download/:id', (req, res) => {
  const id = req.params.id;
  storage.filename(id).then(filename => {
    storage
      .length(id)
      .then(contentLength => {
        res.render('download', {
          filename: filename,
          filesize: bytes(contentLength)
        });
      })
      .catch(() => {
        res.render('download');
      });
  });
});

app.get('/assets/download/:id', (req, res) => {
  const id = req.params.id;
  if (!validateID(id)) {
    res.sendStatus(404);
    return;
  }

  storage
    .filename(id)
    .then(reply => {
      storage.length(id).then(contentLength => {
        res.writeHead(200, {
          'Content-Disposition': 'attachment; filename=' + reply,
          'Content-Type': 'application/octet-stream',
          'Content-Length': contentLength
        });
        const file_stream = storage.get(id);

        file_stream.on(notLocalHost ? 'finish' : 'close', () => {
          storage.forceDelete(id).then(err => {
            if (!err) {
              log.info('Deleted:', id);
            }
          });
        });

        file_stream.pipe(res);
      });
    })
    .catch(err => {
      res.sendStatus(404);
    });
});

app.post('/delete/:id', (req, res) => {
  const id = req.params.id;

  if (!validateID(id)) {
    res.send(404);
    return;
  }

  const delete_token = req.body.delete_token;

  if (!delete_token) {
    res.sendStatus(404);
  }

  storage
    .delete(id, delete_token)
    .then(err => {
      if (!err) {
        log.info('Deleted:', id);
        res.sendStatus(200);
      }
    })
    .catch(err => res.sendStatus(404));
});

app.post('/upload/:id', (req, res, next) => {
  if (!validateID(req.params.id)) {
    res.send(404);
    return;
  }

  req.pipe(req.busboy);
  req.busboy.on('file', (fieldname, file, filename) => {
    log.info('Uploading:', req.params.id);

    const protocol = notLocalHost ? 'https' : req.protocol;
    const url = `${protocol}://${req.get('host')}/download/${req.params.id}/`;

    storage.set(req.params.id, file, filename, url).then(linkAndID => {
      res.json(linkAndID);
    });
  });
});

app.listen(conf.listen_port, () => {
  log.info('startServer:', `Portal app listening on port ${conf.listen_port}!`);
});

const validateID = route_id => {
  return route_id.match(/^[0-9a-fA-F]{32}$/) !== null;
};
