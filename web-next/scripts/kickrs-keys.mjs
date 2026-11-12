// Makes the key pair for Kickrs passes. Run once: node scripts/kickrs-keys.mjs
// The private key goes into a file in your home folder (never the repo); paste it into Railway as
// KICKRS_SIGNING_KEY, then delete the file. The public key is safe to share: send it to Kickrs.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const file = join(homedir(), 'treehouse-kickrs-signing-key.txt');
writeFileSync(file, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
console.log(`Private key saved to ${file}`);
console.log('Paste its contents into Railway as KICKRS_SIGNING_KEY on the treehouse-next service, then delete the file.\n');
console.log('Public key for Kickrs (TREEHOUSE_PUBLIC_KEY), safe to share:');
console.log(publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
