const Airtable = require("airtable");

async function getAgendaFromAirtable(context) {
  const base = new Airtable({
    apiKey: context.env.AIRTABLE_PERSONAL_ACCESS_TOKEN,
  }).base(context.env.AIRTABLE_BASE_ID);

  return new Promise((resolve, reject) => {
    const agenda = [];
    base("Agenda")
      .select({
        view: "Grid view",
      })
      .eachPage(
        (records, fetchNextPage) => {
          // Accumulate records from the current page
          records.forEach((record) => agenda.push(record.fields));

          // Fetch next page if available
          fetchNextPage();
        },
        (err) => {
          if (err) {
            return reject(err);
          }
          resolve(agenda); // Resolve with the accumulated agenda data
        },
      );
  });
}

async function getAlertsFromAirtable(context) {
  const base = new Airtable({
    apiKey: context.env.AIRTABLE_PERSONAL_ACCESS_TOKEN,
  }).base(context.env.AIRTABLE_BASE_ID);

  return new Promise((resolve, reject) => {
    const alerts = [];
    base("Alerts")
      .select({
        view: "Grid view",
      })
      .eachPage(
        (records, fetchNextPage) => {
          // Accumulate records from the current page
          records.forEach((record) => alerts.push(record.fields));

          // Fetch next page if available
          fetchNextPage();
        },
        (err) => {
          if (err) {
            return reject(err);
          }
          resolve(alerts); // Resolve with the accumulated alerts data
        },
      );
  });
}

// New function to fetch Test Attendees
async function getAttendeeInfoFromAirtable(context) {
  console.log("Fetching Test Attendees from Airtable... ", context.env);
  const base = new Airtable({
    apiKey: context.env.AIRTABLE_PERSONAL_ACCESS_TOKEN,
  }).base(context.env.AIRTABLE_BASE_ID);

  return new Promise((resolve, reject) => {
    const attendees = [];
    base("Applied to Attend")
      .select({
        view: "Grid view - Applied to Attend",
      })
      .eachPage(
        (records, fetchNextPage) => {
          // Accumulate records from the current page
          records.forEach((record) => attendees.push(record.fields));

          // Fetch next page if available
          fetchNextPage();
        },
        (err) => {
          if (err) {
            return reject(err);
          }
          resolve(attendees); // Resolve with the accumulated attendee data
        },
      );
  });
}

module.exports = {
  getAgendaFromAirtable,
  getAlertsFromAirtable,
  getAttendeeInfoFromAirtable,
};
