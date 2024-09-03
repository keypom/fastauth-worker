var Airtable = require('airtable');
require('dotenv').config();
const fs = require('fs');

function main(){
    var base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base('appQsBhe43rrhfa6S');
    let newBase = []
    base('Mock Data').select({
        view: "Grid view - Applied to Attend"
    }).eachPage(async function page(records, fetchNextPage) {
        let newRecs = await sendBatchEmails(records)
        newBase = newBase.concat(newRecs)
        // update newBaseRecord
        fetchNextPage();

    }, function done(err) {
        if (err) { console.error(err); return; }
        // console.log("newBase: ", newBase)
    
        // update base, 10 entries of newBase at a time
        // for(let i = 0; i < newBase.length; i+=10){
        //     base('Test Attendees').update(newBase.slice(i, i+10), function(err, records) {
        //         if (err) {
        //             console.error(err);
        //             return;
        //         }
        //         records.forEach(function(record) {
        //             console.log(`Record ${record.getId()} updated`);
        //         });
        //     });
        // }
    });


}

// handle filtering addresses, sending emails, and returning failed deliveries
async function sendBatchEmails(records){
    let addressesToSend = []
    // change this to be object
    let updatedRecords = {}
    // get all addresses that have been approved but not yet emailed
    records.forEach(function(record) {
        if(record.get("Approved") && !record.get("Emailed")){
            addressesToSend.push({
                email: record.get("Email"),
                id: record.id
            })

            // Pre-emptively set all to emailed true, then modify later
            updatedRecords[record.id] = {
                "fields": {
                    "Emailed": true
                }
            }

            console.log("Added to email list: ", {
                email: record.get("Email"),
                id: record.id
            })
        }
    });

    // Mock Sending
    for(i = 0; i < addressesToSend.length; i++){
        let address = addressesToSend[i]
        let email = address.email
        let id = address.id
        // TODO: implement actual sending and error handling here
        let success = email == "minqianlu00@gmail.com"
        if(!success){
            updatedRecords[id] = {
                "fields": {
                    "Email": email,
                    "Emailed": false
                }
            }
        }
    }

    try{
        const existingResult = fs.readFileSync('./src/fake-data/result.json', 'utf8');
        const existingJSON = JSON.parse(existingResult);
        // merge updatedRecords with existingJSON
        updatedRecords = {...existingJSON, ...updatedRecords}
        fs.writeFileSync('./src/fake-data/result.json', JSON.stringify(updatedRecords, null, 2));
    }catch{
        fs.writeFileSync('./src/fake-data/result.json', JSON.stringify(updatedRecords, null, 2));
    }

    // create return array to update Airtable
    let updatedRecordsArray = []
    for (let [key, value] of Object.entries(updatedRecords)) {
        updatedRecordsArray.push({
            "id": key,
            // do not update email
            "fields": {
                "Emailed": value.fields.Emailed
            }
        })
    }
    return updatedRecordsArray
}


// @Ben, this is the function you should be calling
function test(){
    var base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base('appQsBhe43rrhfa6S');
    let newBase = []
    base('Mock Data').select({
        view: "Grid view - Applied to Attend"
    }).eachPage(async function page(records, fetchNextPage) {
        records.forEach(function(record) {
            console.log("record: ", record._rawJson)
        })

    }, function done(err) {
        if (err) { console.error(err); return; }
        // console.log("newBase: ", newBase)
    });


}

module.exports = {
    sendBatchEmails
}

main()
