import Airtable from "airtable";
import { getEnvVariable } from ".";

export async function getAgendaFromAirtable(env) {
  const base = new Airtable({
    apiKey: getEnvVariable("AIRTABLE_PERSONAL_ACCESS_TOKEN", env),
  }).base(getEnvVariable("AIRTABLE_AGENDA_ALERTS_BASE_ID", env));

  return new Promise((resolve, reject) => {
    const agenda = [];
    base(getEnvVariable("AGENDA_TABLE_NAME", env))
      .select({
        view: getEnvVariable("AGENDA_VIEW_NAME", env),
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

export async function getAlertsFromAirtable(env) {
  const base = new Airtable({
    apiKey: getEnvVariable("AIRTABLE_PERSONAL_ACCESS_TOKEN", env),
  }).base(getEnvVariable("AIRTABLE_AGENDA_ALERTS_BASE_ID", env));

  return new Promise((resolve, reject) => {
    const alerts = [];
    base(getEnvVariable("ALERTS_TABLE_NAME", env))
      .select({
        view: getEnvVariable("ALERTS_VIEW_NAME", env),
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

// Function to fetch attendee information
export async function getAttendeeInfoFromAirtable(env) {
  const base = new Airtable({
    apiKey: getEnvVariable("AIRTABLE_PERSONAL_ACCESS_TOKEN", env),
  }).base(getEnvVariable("AIRTABLE_ATTENDEE_BASE_ID", env));

  return new Promise((resolve, reject) => {
    const attendees = [];
    base(getEnvVariable("ATTENDEE_TABLE_NAME", env))
      .select({
        view: getEnvVariable("ATTENDEE_VIEW_NAME", env),
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
