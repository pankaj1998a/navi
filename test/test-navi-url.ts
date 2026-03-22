const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const url = new URL(GOOGLE_AUTH_URL);
url.searchParams.set("client_id", GEMINI_CLIENT_ID);
url.searchParams.set("response_type", "code");
url.searchParams.set("redirect_uri", "http://127.0.0.1:51122/oauth2callback");
url.searchParams.set("scope", [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
].join(" "));
url.searchParams.set("state", "test-state");
url.searchParams.set("access_type", "offline");
url.searchParams.set("prompt", "consent");
url.searchParams.set("code_challenge", "CODE_CHALLENGE");
url.searchParams.set("code_challenge_method", "S256");

console.log(url.toString());
