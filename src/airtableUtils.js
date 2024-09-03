const Airtable = require("airtable");

async function getAgendaFromAirtable(context) {
  const base = new Airtable({
    apiKey: context.env.AIRTABLE_PESONAL_ACCESS_TOKEN,
  }).base(context.env.AIRTABLE_BASE_ID);
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

async function getAlertsFromAirtable(context) {
  const base = new Airtable({
    apiKey: context.env.AIRTABLE_PESONAL_ACCESS_TOKEN,
  }).base(context.env.AIRTABLE_BASE_ID);
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

module.exports = {
  getAgendaFromAirtable,
  getAlertsFromAirtable,
};
