/**
 * Teste la connexion à MongoDB Atlas SANS passer par le fichier .env.
 * L'utilisateur et le mot de passe sont tapés au clavier (le mot de passe est masqué par des étoiles).
 *
 * Utilisation : pnpm check:mongo
 *   - Si la connexion réussit ici mais pas dans l'application, l'erreur est dans .env.
 *   - Si elle échoue ici aussi, l'erreur est dans Atlas (utilisateur, mot de passe ou projet).
 */
import * as readline from 'node:readline';
import mongoose from 'mongoose';

const HOST = 'cluster0.mzarnfh.mongodb.net';
const DATABASE = 'agent_IA';

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = rl[Symbol.asyncIterator]();
  const internals = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
  const writeToOutput = internals._writeToOutput.bind(rl);
  let masked = false;
  // Remplace chaque caractère tapé du mot de passe par une étoile.
  internals._writeToOutput = (text: string) => {
    if (!masked || text.includes('\n')) return writeToOutput(text);
    internals.output.write('*');
  };

  const ask = async (question: string): Promise<string> => {
    process.stdout.write(question);
    const { value } = await lines.next();
    return String(value ?? '').trim();
  };

  const user = await ask('Utilisateur Atlas : ');
  masked = true;
  const password = await ask('Mot de passe : ');
  masked = false;
  rl.close();
  console.log(`\nTest de « ${user} » (mot de passe de ${password.length} caractère(s)) sur ${HOST}...`);

  const uri = `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${HOST}/${DATABASE}?retryWrites=true&w=majority`;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    await mongoose.connection.db!.admin().ping();
    console.log('✅ Connexion réussie : utilisateur et mot de passe sont bons. Recopiez-les dans .env.');
  } catch (error) {
    console.log(`❌ Échec : ${error instanceof Error ? error.message : String(error)}`);
    console.log('   → Le problème est dans Atlas : utilisateur absent de ce projet, mot de passe différent, ou accès limité à d’autres clusters.');
  } finally {
    await mongoose.disconnect();
  }
}

void main();
