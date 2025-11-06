import express from "express";
import fs from "fs";
import * as YAML from "yaml";
import crypto from "crypto";

const app = express();

app.use(express.static("public"));
app.use(express.json());
app.use(
  express.json({
    type: "application/json",
    limit: "2mb",
  }),
);
app.use(
  express.text({
    type: "application/yaml",
    limit: "2mb",
  }),
);

const basePath = process.env.BASE_PATH ?? "./data";

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

  saveTests(tests, requestType);

  if (responseType == "application/yaml") {
    res.setHeader("Content-Type", "application/yaml");
    res.status(200).send(
      YAML.stringify(tests, {
        aliasDuplicateObjects: false,
        blockQuote: "literal",
      }),
    );
  } else res.send(JSON.stringify(tests, null, 2));
});

app.post("/tests", function (req, res) {
  let requestType = req.header("Content-Type") ?? "";
  let responseType = req.header("Accept");

  let uuid = crypto.randomUUID();
  console.log(`Creating test ${uuid}.`);

  let tests: any = req.body;
  if (tests && requestType == "application/yaml") tests = YAML.parse(tests);
  else if (!tests) tests = {};
  tests.id = uuid;

  // create directory
  fs.mkdirSync(`${basePath}/${uuid}`, { recursive: true });

  // save tests, if sent
  saveTests(tests, requestType);
  // create empty results
  let results = {
    results: {},
  };
  saveResults(tests.id, results);
  if (responseType == "application/yaml") {
    res.setHeader("Content-Type", "application/yaml");
    res.status(201).send(
      YAML.stringify(tests, {
        aliasDuplicateObjects: false,
        blockQuote: "literal",
      }),
    );
  } else res.status(201).send(JSON.stringify(tests, null, 2));
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

  let resultsContent = fs.readFileSync(
    `${basePath}/${req.params.id}/results.yaml`,
    "utf8",
  );
  let results: any = YAML.parse(resultsContent);
  if (
    results &&
    results.results &&
    testCaseResults &&
    testCaseResults.extra &&
    testCaseResults.extra.testCase
  ) {
    if (!results.results[testCaseResults.extra.testCase])
      results.results[testCaseResults.extra.testCase] = [];
    results.results[testCaseResults.extra.testCase].push(testCaseResults);
  } else {
    console.error("Could not save test results!");
    console.error(testCaseResults);
    console.error(results);
  }
  saveResults(req.params.id, results);

  if (responseType == "application/yaml") {
    res.setHeader("Content-Type", "application/yaml");
    res.status(200).send(
      YAML.stringify(results, {
        aliasDuplicateObjects: false,
        blockQuote: "literal",
      }),
    );
  } else res.send(JSON.stringify(results, null, 2));
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

function saveTests(tests: any, requestType: string) {
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
}

function saveResults(testId: string, results: any) {
  fs.writeFileSync(
    `${basePath}/${testId}/results.yaml`,
    YAML.stringify(results, {
      aliasDuplicateObjects: false,
      blockQuote: "literal",
    }),
  );
}

app.listen("8080", () => {
  console.log(`app listening on port 8080`);
});
