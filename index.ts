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
  let testId = req.params.id;
  let viewId = testId;
  let testIdPieces = testId.split("-");
  if (testIdPieces.length == 5) {
    testIdPieces.splice(testIdPieces.length - 1);
    viewId = testIdPieces.join("-");
  }
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // no not send ids in the result
    delete tests.viewId;
    delete tests.id;
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
  let testIdPieces = req.params.id.split("-");
  testIdPieces.splice(testIdPieces.length - 1);
  let viewId = testIdPieces.join("-");
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // only allow operation if full id was sent
    if (tests.id === req.params.id) {
      let files = fs.readdirSync(`${basePath}/${viewId}`);
      let zipFile = new yazl.ZipFile();
      for (let file of files) {
        zipFile.addFile(`${basePath}/${viewId}/${file}`, file);
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
      res.status(401).send("Not authorized.");
    }
  } else {
    res.status(404).send("Not found.");
  }
});

app.put("/tests/:id", function (req, res) {
  let requestType = req.header("Content-Type") ?? "";

  if (!req.body) {
    return res.status(400).send("No data received.");
  }

  let testIdPieces = req.params.id.split("-");
  testIdPieces.splice(testIdPieces.length - 1);
  let viewId = testIdPieces.join("-");
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // only allow operation if full id was sent
    if (tests.id === req.params.id) {
      let tests: any = req.body;
      if (tests && requestType == "application/yaml") tests = YAML.parse(tests);
      else if (!tests) tests = {};
      tests.id = req.params.id;
      tests.viewId = viewId;

      let saveResult = saveTests(tests, requestType);

      if (!saveResult) {
        res.status(404).send("Test not found.");
      } else res.send("OK.");
    } else {
      res.status(401).send("Not authorized.");
    }
  } else {
    res.status(404).send("Not found.");
  }
});

app.delete("/tests/:id/", function (req, res) {
  let testIdPieces = req.params.id.split("-");
  testIdPieces.splice(testIdPieces.length - 1);
  let viewId = testIdPieces.join("-");
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // only allow operation if full id was sent
    if (tests.id === req.params.id) {
      fs.rmSync(`${basePath}/${req.params.id}`, {
        recursive: true,
      });
      res.send(`Test ${req.params.id} deleted.`);
    } else {
      res.status(401).send("Not authorized.");
    }
  } else {
    res.status(404).send("Not found.");
  }
});

app.delete("/tests/:id/cases/:caseId", function (req, res) {
  let testIdPieces = req.params.id.split("-");
  testIdPieces.splice(testIdPieces.length - 1);
  let viewId = testIdPieces.join("-");
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // only allow operation if full id was sent
    if (tests.id === req.params.id) {
      fileContents = fs.readFileSync(
        `${basePath}/${viewId}/results.yaml`,
        "utf8",
      );
      let results = YAML.parse(fileContents);
      if (results.results[req.params.caseId]) {
        delete results.results[req.params.caseId];
        results.updated = Date.now();
        sendTestsUpdateEvent(viewId, results);

        fs.writeFileSync(
          `${basePath}/${viewId}/results.yaml`,
          YAML.stringify(results, {
            aliasDuplicateObjects: false,
            blockQuote: "literal",
          }),
        );

        if (fs.existsSync(`${basePath}/${viewId}/${req.params.caseId}.yaml`)) {
          fs.rmSync(`${basePath}/${viewId}/${req.params.caseId}.yaml`);
        }
      }

      res.send(`Test case ${req.params.caseId} deleted.`);
    } else {
      res.status(401).send("Not authorized.");
    }
  } else {
    res.status(404).send("Not found.");
  }
});

app.post("/tests", function (req, res) {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");

  let uuid = crypto.randomUUID();
  let uuidPieces = uuid.split("-");
  uuidPieces.splice(uuidPieces.length - 1);
  let vuId = uuidPieces.join("-");

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
          method: "GET",
          assertions: [
            "$.firstName==john",
            "$.city==San Jose",
            "response.header.content-length==68",
          ],
        },
      ],
    };
  tests.id = uuid;
  tests.viewId = vuId;

  // create directory
  fs.mkdirSync(`${basePath}/${vuId}`, { recursive: true });

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
  } else res.status(201).send(JSON.stringify(tests, null, 2));
});

app.post("/tests/:id/run", async (req, res) => {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");
  let testIdPieces = req.params.id.split("-");
  testIdPieces.splice(testIdPieces.length - 1);
  let viewId = testIdPieces.join("-");
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // only allow operation if full id was sent
    if (tests.id === req.params.id) {
      let tests: any = req.body;
      if (tests && requestType == "application/yaml") tests = YAML.parse(tests);
      tests.id = req.params.id;
      tests.viewId = viewId;
      if (tests) saveTests(tests, requestType);

      if (!tests && fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
        let fileContents = fs.readFileSync(
          `${basePath}/${viewId}/tests.yaml`,
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
    } else {
      res.status(401).send("Not authorized.");
    }
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

  let testIdPieces = req.params.id.split("-");
  testIdPieces.splice(testIdPieces.length - 1);
  let viewId = testIdPieces.join("-");
  if (fs.existsSync(`${basePath}/${viewId}/tests.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/tests.yaml`,
      "utf8",
    );
    let tests = YAML.parse(fileContents);
    // only allow operation if full id was sent
    if (tests.id === req.params.id) {
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
      updateResults(viewId, testCaseResults);
      updateTestCaseResults(viewId, testCaseId, testCaseResults);
      if (responseType == "application/yaml") {
        res.setHeader("Content-Type", "application/yaml");
        res.status(200).send("OK.");
      } else res.send("OK.");
    } else {
      res.status(401).send("Not authorized.");
    }
  } else {
    return res.status(404).send("Not found.");
  }
});

app.get("/tests/:id/results", function (req, res) {
  let responseType = req.header("Accept");
  let testId = req.params.id;
  let viewId = testId;
  let testIdPieces = testId.split("-");
  if (testIdPieces.length == 5) {
    testIdPieces.splice(testIdPieces.length - 1);
    viewId = testIdPieces.join("-");
  }
  if (fs.existsSync(`${basePath}/${viewId}/results.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/results.yaml`,
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

app.get("/tests/:id/cases/:caseId/results", function (req, res) {
  let responseType = req.header("Accept");
  let testId = req.params.id;
  let viewId = testId;
  let testIdPieces = testId.split("-");
  if (testIdPieces.length == 5) {
    testIdPieces.splice(testIdPieces.length - 1);
    viewId = testIdPieces.join("-");
  }
  if (fs.existsSync(`${basePath}/${viewId}/${req.params.caseId}.yaml`)) {
    let fileContents = fs.readFileSync(
      `${basePath}/${viewId}/${req.params.caseId}.yaml`,
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

    try {
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
                stop: Date.now(),
              },
              tests: [],
            },
          };

          if (testCaseObject.url && testCaseObject.runner != "external") {
            let response = await fetch(
              testCaseObject.url + (testCaseObject.path ?? ""),
              {
                method: testCaseObject.method ?? "GET",
                body: testCaseObject.body,
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
            testResults.results.summary.stop = Date.now();
            results.push(testResults);
            updateResults(tests.viewId, testResults);
            updateTestCaseResults(
              tests.viewId,
              testCaseObject.name,
              testResults,
            );
          }
        }
      }
    } catch (e) {
      console.log(`ERROR testing ${tests.name}: ${e.message}`);
    }

    resolve(results);
  });
}

// This is a standard checkAssertions method that can be used in any javascript environment (nodejs, apigee, others).
function checkAssertions(
  testCaseObject,
  testResults,
  context,
  responseContent,
) {
  for (var i = 0; i < testCaseObject.assertions.length; i++) {
    var assertion = testCaseObject.assertions[i];
    if (assertion.includes("!==")) {
      // doesn't equal strict
      var pieces = assertion.split("!==");
      if (pieces.length === 2) {
        var value = getValue(pieces[0], context, responseContent);
        if (value.trim() !== pieces[1].trim()) {
          testResults.results.summary.tests++;
          testResults.results.summary.passed++;
          testResults.results.tests.push({
            name: assertion,
            status: "passed",
            message: "Values matched: " + pieces[1] + "!==" + value,
            duration: 0,
          });
        } else {
          testResults.results.summary.tests++;
          testResults.results.summary.failed++;
          testResults.results.tests.push({
            name: assertion,
            status: "failed",
            message: "Value didn't match: " + pieces[1] + "===" + value,
            duration: 0,
          });
        }
      }
    } else if (assertion.includes("!=")) {
      // doesn't equal
      var pieces = assertion.split("!=");
      if (pieces.length === 2) {
        var value = getValue(pieces[0], context, responseContent);
        if (value.trim().toLowerCase() != pieces[1].trim().toLowerCase()) {
          testResults.results.summary.tests++;
          testResults.results.summary.passed++;
          testResults.results.tests.push({
            name: assertion,
            status: "passed",
            message: "Values matched: " + pieces[1] + "!=" + value,
            duration: 0,
          });
        } else {
          testResults.results.summary.tests++;
          testResults.results.summary.failed++;
          testResults.results.tests.push({
            name: assertion,
            status: "failed",
            message: "Value didn't match: " + pieces[1] + "==" + value,
            duration: 0,
          });
        }
      }
    } else if (assertion.includes("===")) {
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
  try {
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
  } catch (e) {
    console.error(`ERROR getValue: ${name} - ${e.message}`);
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
  if (!fs.existsSync(`${basePath}/${tests.viewId}`)) {
    result = false;
    return result;
  }
  switch (requestType) {
    case "application/yaml":
      // yaml
      fs.writeFileSync(
        `${basePath}/${tests.viewId}/tests.yaml`,
        YAML.stringify(tests, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
      break;
    default:
      // json
      fs.writeFileSync(
        `${basePath}/${tests.viewId}/tests.yaml`,
        YAML.stringify(tests, {
          aliasDuplicateObjects: false,
          blockQuote: "literal",
        }),
      );
      break;
  }

  // create results files, if not exist
  if (!fs.existsSync(`${basePath}/${tests.viewId}/results.yaml`)) {
    fs.writeFileSync(
      `${basePath}/${tests.viewId}/results.yaml`,
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

function updateResults(testViewId: string, testCaseResults: any): boolean {
  let result = true;

  let resultsContent = fs.readFileSync(
    `${basePath}/${testViewId}/results.yaml`,
    "utf8",
  );
  let results: any = undefined;
  if (resultsContent) results = YAML.parse(resultsContent);
  else {
    result = false;
    console.error(`Could not find results file for test ${testViewId}`);
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
  sendTestsUpdateEvent(testViewId, results);

  fs.writeFileSync(
    `${basePath}/${testViewId}/results.yaml`,
    YAML.stringify(results, {
      aliasDuplicateObjects: false,
      blockQuote: "literal",
    }),
  );
  return result;
}

function updateTestCaseResults(
  testViewId: string,
  testCaseId: string,
  testCaseResults: any,
): boolean {
  let result = true;
  let results: any = undefined;
  if (fs.existsSync(`${basePath}/${testViewId}/${testCaseId}.yaml`)) {
    let resultsContent = fs.readFileSync(
      `${basePath}/${testViewId}/${testCaseId}.yaml`,
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
    sendTestsUpdateEvent(testViewId + "." + testCaseId, results);

    fs.writeFileSync(
      `${basePath}/${testViewId}/${testCaseId}.yaml`,
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

app.listen(process.env.PORT ? process.env.PORT : "8080", () => {
  console.log(
    `app listening on port ${process.env.PORT ? process.env.PORT : "8080"}`,
  );
});

process.on("beforeExit", (code) => {
  console.log("Process beforeExit event with code: ", code);
});
