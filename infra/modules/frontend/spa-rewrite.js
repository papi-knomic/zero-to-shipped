// CloudFront Function (cloudfront-js-2.0), viewer-request on the S3 behaviour.
// "/" is the static landing page (index.html, the default root object). Any other path whose
// last segment has no file extension is a route in the React demo, served by app.html.
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.split('/').pop();

  if (request.uri !== '/' && lastSegment.indexOf('.') === -1) {
    request.uri = '/app.html';
  }

  return request;
}
