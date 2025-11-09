import express, { response } from "express";
import fs from "fs";
import * as YAML from "yaml";
import crypto from "crypto";
import jp from "jsonpath";
import yazl from "yazl";

const app = express();

app.use(express.static("public"));
app.use(express.json());
app.use(
  express.json({
    type: "application/json",
    limit: "8mb",
  }),
);
app.use(
  express.text({
    type: "application/yaml",
    limit: "8mb",
  }),
);

const basePath = process.env.BASE_PATH ?? "./data";
const eventClients = {};

app.get("/tests/:id", function (req, res) {
  let responseType = req.header("Accept");
  if (fs.existsSync(`${basePath}/${req.params.id}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${req.params.id}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    if (responseType == "application/yaml") {
      res.setHeader("Content-Type", "application/yaml");
      res.send(
        YAML.stringify(tests, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
    } else res.send(JSON.stringify(tests, null, 2));
  } else {
    res.status(404).send("Not found.");
  }
});

app.get("/tests/:id/download", function (req, res) {
  if (fs.existsSync(`${basePath}/${req.params.id}`)) {
    let files = fs.readdirSync(`${basePath}/${req.params.id}`);
    let zipFile = new yazl.ZipFile();
    for (let file of files) {
      zipFile.addFile(`${basePath}/${req.params.id}/${file}`, file);
    }
    zipFile.outputStream
      .pipe(fs.createWriteStream(req.params.id + ".zip"))
      .on("close", function () {
        let returnFile = fs.readFileSync(req.params.id + ".zip");
        res.setHeader("Content-Type", "application/octet-stream");
        res.status(201).send(returnFile);
        fs.rmSync(req.params.id + ".zip");
      });
    zipFile.end();
  } else {
    res.status(404).send("Test suite not found.");
  }
});

app.put("/tests/:id", function (req, res) {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");

  if (!req.body) {
    return res.status(400).send("No data received.");
  }

  let tests: any = req.body;
  if (tests && requestType == "application/yaml") tests = YAML.parse(tests);
  else if (!tests) tests = {};
  tests.id = req.params.id;

  let saveResult = saveTests(tests, requestType);

  if (!saveResult) {
    res.status(404).send("Test not found.");
  } else res.send("OK.");
});

app.delete("/tests/:id", function (req, res) {
  if (fs.existsSync(`${basePath}/${req.params.id}`)) {
    fs.rmSync(`${basePath}/${req.params.id}`, {
      recursive: true,
    });
    res.send(`Test ${req.params.id} deleted.`);
  } else {
    res.status(404).send("Not found.");
  }
});

app.post("/tests", function (req, res) {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");

  let uuid = crypto.randomUUID();
  console.log(`Creating test ${uuid}.`);

  let tests: any = req.body;
  if (tests && requestType == "application/yaml") tests = YAML.parse(tests);
  else if (!tests)
    tests = {
      name: "Mock Target Tests v1",
      tests: [
        {
          name: "test response payload",
          url: "https://mocktarget.apigee.net",
          path: "/json",
          verb: "GET",
          assertions: [
            "$.firstName==john",
            "$.city==San Jose",
            "response.header.content-length==68",
          ],
        },
      ],
    };
  tests.id = uuid;

  // create directory
  fs.mkdirSync(`${basePath}/${uuid}`, { recursive: true });

  // save tests.yaml and results.yaml
  saveTests(tests, requestType);
  // do first run
  runTests(tests);

  if (responseType == "application/yaml") {
    res.setHeader("Content-Type", "application/yaml");
    res.status(201).send(
      YAML.stringify(
        {
          id: tests.id,
        },
        {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        },
      ),
    );
  } else
    res.status(201).send(
      JSON.stringify(
        {
          id: tests.id,
        },
        null,
        2,
      ),
    );
});

app.post("/tests/:id/run", async (req, res) => {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");
  let tests: any = req.body;
  if (tests && requestType == "application/yaml") tests = YAML.parse(tests);
  if (tests) saveTests(tests, requestType);

  if (!tests && fs.existsSync(`${basePath}/${req.params.id}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${req.params.id}/tests.yaml`,
      "utf8",
    );
    tests = YAML.parse(fileContents);
  }

  if (tests) {
    let results = await runTests(tests);
    if (responseType == "application/yaml") {
      res.setHeader("Content-Type", "application/yaml");
      res.send(
        YAML.stringify(results, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
    } else res.send(JSON.stringify(results, null, 2));
  } else {
    res.status(404).send("Not found.");
  }
});

app.post("/tests/:id/results", function (req, res) {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");

  if (!req.body) {
    return res.status(400).send("No data received.");
  }

  let testCaseResults: any = req.body;
  if (testCaseResults && requestType == "application/yaml")
    testCaseResults = YAML.parse(testCaseResults);
  let testCaseId = "";
  if (
    testCaseResults &&
    testCaseResults.extra &&
    testCaseResults.extra.testCase
  )
    testCaseId = testCaseResults.extra.testCase;

  // update results overview
  updateResults(req.params.id, testCaseResults);
  updateTestCaseResults(req.params.id, testCaseId, testCaseResults);
  if (responseType == "application/yaml") {
    res.setHeader("Content-Type", "application/yaml");
    res.status(200).send("OK.");
  } else res.send("OK.");
});

app.get("/tests/:id/results", function (req, res) {
  let responseType = req.header("Accept");
  if (fs.existsSync(`${basePath}/${req.params.id}/results.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${req.params.id}/results.yaml`,
      "utf8",
    );
    let results = YAML.parse(fileContents);
    if (responseType == "application/yaml") {
      res.setHeader("Content-Type", "application/yaml");
      res.send(
        YAML.stringify(results, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
    } else res.send(JSON.stringify(results, null, 2));
  } else {
    res.status(404).send("Not found.");
  }
});

app.get("/tests/:id/results/:caseId", function (req, res) {
  let responseType = req.header("Accept");
  if (fs.existsSync(`${basePath}/${req.params.id}/${req.params.caseId}.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${req.params.id}/${req.params.caseId}.yaml`,
      "utf8",
    );
    let results = YAML.parse(fileContents);
    if (responseType == "application/yaml") {
      res.setHeader("Content-Type", "application/yaml");
      res.send(
        YAML.stringify(results, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
    } else res.send(JSON.stringify(results, null, 2));
  } else {
    res.status(404).send("Not found.");
  }
});

app.get("/events", (req, res) => {
  // Set headers to keep the connection alive and tell the client we're sending event-stream data
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  let eventId = req.query.id?.toString() ?? "";
  if (eventId && eventClients[eventId]) {
    eventClients[eventId].push(res);
  } else if (eventId) {
    eventClients[eventId] = [res];
  }

  // When client closes connection, stop sending events
  req.on("close", () => {
    // clearInterval(intervalId);
    res.end();
  });
});

async function runTests(tests: any): Promise<any> {
  return new Promise(async (resolve, reject) => {
    let results: any[] = [];
    if (tests.tests) {
      for (let testCaseObject of tests.tests) {
        var testResults = {
          reportFormat: "CTRF",
          extra: {
            testCase: testCaseObject.name,
            response: "",
            responseHeaders: {},
          },
          results: {
            tool: {
              name: "upstr",
            },
            summary: {
              tests: 0,
              passed: 0,
              failed: 0,
              start: Date.now(),
            },
            tests: [],
          },
        };

        if (testCaseObject.url) {
          let response = await fetch(
            testCaseObject.url + (testCaseObject.path ?? ""),
            {
              method: testCaseObject.verb ?? "GET",
              body: testCaseObject.request,
              headers: testCaseObject.headers,
            },
          );
          let responseContent = await response.text();
          testResults.extra.response = responseContent;
          for (let header of response.headers) {
            testResults.extra.responseHeaders[header[0]] = header[1];
          }
          checkAssertions(
            testCaseObject,
            testResults,
            response,
            responseContent,
          );
          results.push(testResults);
          updateResults(tests.id, testResults);
          updateTestCaseResults(tests.id, testCaseObject.name, testResults);
        }
      }
    }

    resolve(results);
  });
}

function checkAssertions(
  testCaseObject,
  testResults,
  context,
  responseContent,
) {
  for (var i = 0; i < testCaseObject.assertions.length; i++) {
    var assertion = testCaseObject.assertions[i];
    if (assertion.includes("===")) {
      // exact test
      var pieces = assertion.split("===");
      if (pieces.length === 2) {
        var value = getValue(pieces[0], context, responseContent);
        if (value.trim() === pieces[1].trim()) {
          testResults.results.summary.tests++;
          testResults.results.summary.passed++;
          testResults.results.tests.push({
            name: assertion,
            status: "passed",
            message: "Values matched: " + pieces[1] + "===" + value,
            duration: 0,
          });
        } else {
          console.log("Assertion " + assertion + " failed: " + value);
          testResults.results.summary.tests++;
          testResults.results.summary.failed++;
          testResults.results.tests.push({
            name: assertion,
            status: "failed",
            message: "Value didn't match: " + pieces[1] + "!==" + value,
            duration: 0,
          });
        }
      }
    } else if (assertion.includes("==")) {
      // rough test
      var pieces = assertion.split("==");
      if (pieces.length === 2) {
        var value = getValue(pieces[0], context, responseContent);
        if (value.trim().toLowerCase() == pieces[1].trim().toLowerCase()) {
          testResults.results.summary.tests++;
          testResults.results.summary.passed++;
          testResults.results.tests.push({
            name: assertion,
            status: "passed",
            message: "Values matched: " + pieces[1] + "==" + value,
            duration: 0,
          });
        } else {
          console.log("Assertion " + assertion + " failed: " + value);
          testResults.results.summary.tests++;
          testResults.results.summary.failed++;
          testResults.results.tests.push({
            name: assertion,
            status: "failed",
            message: "Value didn't match: " + pieces[1] + "!=" + value,
            duration: 0,
          });
        }
      }
    } else if (assertion.includes(":")) {
      // contains
      var pieces = assertion.split(":");
      if (pieces.length === 2) {
        var value = getValue(pieces[0], context, responseContent);
        if (value.trim().includes(pieces[1].trim())) {
          testResults.results.summary.tests++;
          testResults.results.summary.passed++;
          testResults.results.tests.push({
            name: assertion,
            status: "passed",
            message: "Values matched: " + pieces[1] + ":" + value,
            duration: 0,
          });
        } else {
          console.log("Assertion " + assertion + " failed: " + value);
          testResults.results.summary.tests++;
          testResults.results.summary.failed++;
          testResults.results.tests.push({
            name: assertion,
            status: "failed",
            message: "Value didn't match: " + pieces[1] + "!:" + value,
            duration: 0,
          });
        }
      }
    }
  }
}

function getValue(name: string, context: any, responseContent: any): string {
  let result = "";
  if (name.startsWith("$")) {
    result = jp.query(JSON.parse(responseContent), name);
  } else if (name.startsWith("response.header")) {
    let simpleName = name.replace("response.header.", "");
    result = context.headers.get(simpleName);
    if (!result) {
      console.log(`Could not find header ${simpleName}.`);
      result = "";
    }
  }
  return result.toString();
}

function sendTestsUpdateEvent(eventId: string, data: any) {
  if (eventClients[eventId]) {
    for (let res of eventClients[eventId]) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }
}

function saveTests(tests: any, requestType: string): boolean {
  let result = true;
  if (!fs.existsSync(`${basePath}/${tests.id}`)) {
    result = false;
    return result;
  }
  switch (requestType) {
    case "application/yaml":
      // yaml
      fs.writeFileSync(
        `${basePath}/${tests.id}/tests.yaml`,
        YAML.stringify(tests, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
      break;
    default:
      // json
      fs.writeFileSync(
        `${basePath}/${tests.id}/tests.yaml`,
        YAML.stringify(tests, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
      break;
  }

  // create results files, if not exist
  if (!fs.existsSync(`${basePath}/${tests.id}/results.yaml`)) {
    fs.writeFileSync(
      `${basePath}/${tests.id}/results.yaml`,
      YAML.stringify(
        {
          results: {},
          updated: Date.now(),
        },
        {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        },
      ),
    );
  }

  return result;
}

function updateResults(testId: string, testCaseResults: any): boolean {
  let result = true;

  let resultsContent = fs.readFileSync(
    `${basePath}/${testId}/results.yaml`,
    "utf8",
  );
  let results: any = undefined;
  if (resultsContent) results = YAML.parse(resultsContent);
  else {
    result = false;
    console.error(`Could not find results file for test ${testId}`);
    return result;
  }
  if (
    results &&
    results.results &&
    testCaseResults &&
    testCaseResults.extra &&
    testCaseResults.extra.testCase &&
    testCaseResults.results &&
    testCaseResults.results.summary
  ) {
    results.results[testCaseResults.extra.testCase] =
      testCaseResults.results.summary;
  } else {
    result = false;
    console.error("Could not save test results!");
    console.error(testCaseResults);
    console.error(results);
    return result;
  }
  results.updated = Date.now();
  sendTestsUpdateEvent(testId, results);

  fs.writeFileSync(
    `${basePath}/${testId}/results.yaml`,
    YAML.stringify(results, {
      aliasDuplicateObjects: false,
      blockQuote: "literal",
    }),
  );
  return result;
}

function updateTestCaseResults(
  testId: string,
  testCaseId: string,
  testCaseResults: any,
): boolean {
  let result = true;
  let results: any = undefined;
  if (fs.existsSync(`${basePath}/${testId}/${testCaseId}.yaml`)) {
    let resultsContent = fs.readFileSync(
      `${basePath}/${testId}/${testCaseId}.yaml`,
      "utf8",
    );
    results = YAML.parse(resultsContent);
  } else {
    results = {
      testCaseId: testCaseId,
      results: [],
    };
  }

  results.updated = Date.now();

  if (results && results.results && testCaseResults) {
    results.results.push(testCaseResults);
    sendTestsUpdateEvent(testId + "." + testCaseId, results);

    fs.writeFileSync(
      `${basePath}/${testId}/${testCaseId}.yaml`,
      YAML.stringify(results, {
        aliasDuplicateObjects: false,
        blockQuote: "literal",
      }),
    );
  } else {
    result = false;
    console.error("Could not save test results!");
    console.error(testCaseResults);
    console.error(results);
  }

  return result;
}

app.listen("8080", () => {
  console.log(`app listening on port 8080`);
});

process.on("beforeExit", (code) => {
  console.log("Process beforeExit event with code: ", code);
});
