const Airtable = require("airtable");
require("dotenv").config();

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  "appQsBhe43rrhfa6S",
);

async function getAgendaFromAirtable() {
  return new Promise((resolve, reject) => {
    base("Agenda")
      .select({
        view: "Grid view",
      })
      .firstPage((err, records) => {
        if (err) {
          return reject(err);
        }
        const agenda = records.map((record) => record.fields);
        resolve(agenda);
      });
  });
}

async function updateAgendaInAirtable(newAgenda) {
  return new Promise((resolve, reject) => {
    base("Agenda").update(newAgenda, function (err, records) {
      if (err) {
        return reject(err);
      }
      resolve(records);
    });
  });
}

async function getAlertsFromAirtable() {
  return new Promise((resolve, reject) => {
    base("Alerts")
      .select({
        view: "Grid view",
      })
      .firstPage((err, records) => {
        if (err) {
          return reject(err);
        }
        const alerts = records.map((record) => record.fields);
        resolve(alerts);
      });
  });
}

async function updateAlertsInAirtable(newAlerts) {
  return new Promise((resolve, reject) => {
    base("Alerts").update(newAlerts, function (err, records) {
      if (err) {
        return reject(err);
      }
      resolve(records);
    });
  });
}

module.exports = {
  getAgendaFromAirtable,
  updateAgendaInAirtable,
  getAlertsFromAirtable,
  updateAlertsInAirtable,
};
