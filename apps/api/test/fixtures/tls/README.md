# Test-only TLS files

A throwaway certificate authority (`ca.pem`) and a certificate for `localhost` signed by it (`server.pem`,
`server-key.pem`), used by `test/extra-ca-certs.test.ts`. The CA's own key was deleted after signing, so nothing
else can be issued from it. Valid until November 2046. Never use these outside the tests.
