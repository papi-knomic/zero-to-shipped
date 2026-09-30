// CloudFront Function (cloudfront-js-2.0), viewer-request on the S3 behaviour.
// Any path whose last segment has no file extension is a client-side route.
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.split('/').pop();

  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
