import 'dotenv/config';
import { openDatabase } from './database.js';

const db = openDatabase(process.env.DATABASE_PATH ?? './data/bot.sqlite');
db.close();
console.log('Ma’lumotlar bazasi migratsiyalari bajarildi.');
