function handler(event) {
  var request = event.request;

  // Basic 認証(UI と /api の両方)
  var expected = "Basic __BASIC_AUTH_TOKEN__";
  var authHeader = request.headers.authorization;
  if (!authHeader || authHeader.value !== expected) {
    return {
      statusCode: 401,
      statusDescription: "Unauthorized",
      headers: {
        "www-authenticate": { value: 'Basic realm="issue-canvas"' },
      },
    };
  }

  // Lambda Function URL(NONE 認証)は Authorization ヘッダーが付いていると AWS 署名とみなして拒否するため、
  // 検証済みの Basic 認証ヘッダーはオリジンに転送しない
  delete request.headers.authorization;

  return request;
}
