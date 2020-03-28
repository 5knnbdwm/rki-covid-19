require('custom-env').env();

const express = require('express');
const app = express();
const port = 3000;
const fetch = require('node-fetch');
const { CronJob } = require('cron');
const mongoose = require('mongoose');
const cheerio = require('cheerio');

if (process.env.APP_ENV === 'dev') {
  mongoose.connect(`mongodb://${process.env.DB_HOST}/covid-19`, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    keepAlive: true,
    keepAliveInitialDelay: 300000,
    useFindAndModify: false,
  });
} else {
  mongoose.connect(
    `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}/covid-19`,
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      keepAlive: true,
      keepAliveInitialDelay: 300000,
      useFindAndModify: false,
    }
  );
}

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {
  console.log('we_re connected!');
});

var rki_log = {
  name: 'rki_log',
  schema: new mongoose.Schema({
    created_at: Date,
    info: String,
    error: String,
  }),
  model: null,
};
rki_log.model = mongoose.model(rki_log.name, rki_log.schema);

var rki_data = {
  name: 'rki_data',
  schema: new mongoose.Schema({
    checked_at: Date,
    update_at: Date,
    data: Array,
  }),
  model: null,
};
rki_data.model = mongoose.model(rki_data.name, rki_data.schema);

async function getHTML() {
  let raw_html = [];

  await fetch('https://www.rki.de/DE/Content/InfAZ/N/Neuartiges_Coronavirus/Fallzahlen.html')
    .then((res) => res.text())
    .then((body) => (raw_html = body));

  return raw_html;
}

async function parseTableData(html) {
  let $ = cheerio.load(html, {
    withDomLvl1: true,
    normalizeWhitespace: true,
    xmlMode: false,
    decodeEntities: false,
  });
  const struct = ['State', 'Amount', 'Diff', 'Ratio', 'Dead', 'Info'];
  let states = [];

  $('table tbody tr').each(function (index, element) {
    let state = {};
    $(element)
      .children()
      .each(function (index, child) {
        state[struct[index]] = $(child).html();
      });

    states.push(state);
  });

  states.pop();
  return states;
}

async function parseInfoData(html) {
  let $ = cheerio.load(html);
  let content;
  let update_at;
  let date = new Date();

  $('#main .text').each(function (index, element) {
    if (index == 0) {
      content = $(element).find('p').html();
    }
  });

  update_at = content.match(/\s(\d\d?.\d\d?.\d{4},\s\d\d?:\d\d)\s/)[1];

  let res = update_at.split(/\.|\,\s|\:/);

  date.setYear(res[2]);
  date.setMonth(res[1] - 1, res[0]);
  date.setHours(res[3] - 1, res[4], 0, 0);

  return new Date(date);
}

let cronSchedule;
process.env.APP_ENV === 'dev' ? (cronSchedule = '*/15 * * * * *') : (cronSchedule = '0 */1 * * *');
// in env=dev run every 15 sec, in env=prod run every hour

new CronJob(
  cronSchedule,
  async function () {
    console.log('here');
    let raw_html = await getHTML();
    let tableData;
    let infoData;
    let working = true;
    let e = '';

    try {
      tableData = await parseTableData(raw_html);
    } catch (e) {
      e = e;
      working = false;
    }

    try {
      infoData = await parseInfoData(raw_html);
    } catch (e) {
      e = e;
      working = false;
    }

    if (working) {
      for (let i = 0; i < tableData.length; i++) {
        tableData[i]['Amount'] = Number(tableData[i]['Amount'].replace(/\./, ''));
        tableData[i]['Diff'] = Number(tableData[i]['Diff'].replace(/\./, ''));
        tableData[i]['Ratio'] = Number(tableData[i]['Ratio'].replace(/\./, ''));
        tableData[i]['Dead'] = Number(tableData[i]['Dead'].replace(/\./, ''));
      }

      try {
        await new rki_log.model({
          created_at: new Date(),
          info: 'New entry created',
          error: '',
        }).save();
      } catch (e) {
        console.log(e);
      }

      try {
        await new rki_data.model({
          checked_at: new Date(),
          update_at: infoData,
          data: tableData,
        }).save();
      } catch (e) {
        console.log(e);
      }
    } else {
      try {
        new rki_log.model({
          created_at: new Date(),
          info: 'Error in program.',
          error: e,
        }).save();
      } catch (e) {
        console.log(e);
      }
    }
  },
  null,
  true
);

app.get('/', async function (req, res) {
  let data = await rki_log.model.find();
  var text = '';
  data.length > 20 ? (data = data.reverse().slice(0, 20)) : (data = data.reverse());

  for (let i = 0; i < data.length; i++) {
    let item = '';
    console.log(data[i]);
    data[i]['error'] == '' ? console.log(true) : console.log(false);

    if (data[i]['error'] == '') {
      item = new Date(data[i]['created_at']) + ' - ' + data[i]['info'];
    } else {
      item = new Date(data[i]['created_at']) + ' - ' + data[i]['info'] + ' - ' + data[i]['error'];
    }
    text += item + '<br>';
  }

  res.send(text);
});

app.get('/data', async function (req, res) {
  let data = await rki_data.model.find();
  res.send(data);
});

// eslint-disable-next-line no-console
app.listen(port, () => console.log(`Example app listening on port ${port}!`));
