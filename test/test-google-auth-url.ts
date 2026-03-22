import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client({
    clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
    clientSecret: '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',
});

const authUrl = client.generateAuthUrl({
    redirect_uri: 'http://127.0.0.1:51122/oauth2callback',
    access_type: 'offline',
    scope: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state: 'test-state',
});

console.log(authUrl);
