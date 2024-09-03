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

// Verify HMAC signature
function verifyHMAC(request, macSecretBase64) {
  try {
    const macSecretDecoded = Buffer.from(macSecretBase64, "base64");
    const body = request.clone().text(); // Clone the request to read it twice
    const hmac = crypto.createHmac("sha256", macSecretDecoded);
    hmac.update(body, "utf8");
    const expectedHMAC = "hmac-sha256=" + hmac.digest("hex");
    const receivedHMAC = request.headers.get("X-Airtable-Content-MAC");

    if (expectedHMAC !== receivedHMAC) {
      throw new Error("HMAC verification failed.");
    }
  } catch (error) {
    console.error("Error verifying HMAC:", error);
    throw new Error("HMAC verification failed.");
  }
}

module.exports = {
  verifyHMAC,
  getAgendaFromAirtable,
  getAlertsFromAirtable,
};
