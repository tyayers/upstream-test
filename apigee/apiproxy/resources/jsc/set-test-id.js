var upstreamId = context.getVariable("request.header.x-upstream-id");
if (!upstreamId) {
  // try from properties
  upstreamId = context.getVariable("propertyset.tester.UPSTREAM_ID")
}
if (upstreamId && upstreamId.includes(".")) {
  var pieces = upstreamId.split(".");
  context.setVariable("upstream.testId", pieces[0]);
  context.setVariable("upstream.testCaseId", pieces[1]);
} else {
  context.setVariable("upstream.testId", upstreamId);
}