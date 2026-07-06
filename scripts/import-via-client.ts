import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diset di .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

function convertValue(valStr: string): any {
    valStr = valStr.trim();
    if (valStr.toLowerCase() === 'null') {
        return null;
    }
    if (valStr.toLowerCase() === 'true') {
        return true;
    }
    if (valStr.toLowerCase() === 'false') {
        return false;
    }
    if (valStr.startsWith("'") && valStr.endsWith("'")) {
        const inner = valStr.slice(1, -1);
        const unescaped = inner.replace(/''/g, "'");
        // If it's a JSON string, we can try to parse it, but database can accept string too.
        // Let's check if it's JSON array or object
        if ((unescaped.startsWith('[') && unescaped.endsWith(']')) || (unescaped.startsWith('{') && unescaped.endsWith('}'))) {
            try {
                return JSON.parse(unescaped);
            } catch (e) {
                // Fallback to string if not valid JSON
                return unescaped;
            }
        }
        return unescaped;
    }
    if (valStr.startsWith('ARRAY[') && valStr.endsWith(']')) {
        const arrayContent = valStr.slice(6, -1).trim();
        if (!arrayContent) return [];

        const items: any[] = [];
        let cur = '';
        let inStr = false;
        for (let i = 0; i < arrayContent.length; i++) {
            const char = arrayContent[i];
            if (char === "'") {
                inStr = !inStr;
                cur += char;
            } else if (char === ',' && !inStr) {
                items.push(convertValue(cur));
                cur = '';
            } else {
                cur += char;
            }
        }
        if (cur) {
            items.push(convertValue(cur));
        }
        return items;
    }

    const num = Number(valStr);
    if (!isNaN(num) && valStr !== '') {
        return num;
    }
    return valStr;
}

function parseSqlFileToObjects(filePath: string): any[] {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Match the INSERT INTO part and extract columns and values
    const insertRegexp = /INSERT\s+INTO\s+[^\s(]+\s*\(([^)]+)\)\s*VALUES\s*/i;
    const match = content.match(insertRegexp);
    if (!match) {
        throw new Error(`Failed to parse insert statement in ${filePath}`);
    }

    const columnsStr = match[1];
    const valuesStartIndex = match.index! + match[0].length;
    // Strip trailing ON CONFLICT (id) DO NOTHING;
    let valuesPart = content.slice(valuesStartIndex).trim();
    if (valuesPart.endsWith('ON CONFLICT (id) DO NOTHING;')) {
        valuesPart = valuesPart.slice(0, -'ON CONFLICT (id) DO NOTHING;'.length).trim();
    }
    if (valuesPart.endsWith(';')) {
        valuesPart = valuesPart.slice(0, -1).trim();
    }

    // Parse columns
    const columns = columnsStr.split(',').map(c => c.trim().replace(/"/g, ''));

    // Parse values row by row char-by-char scanner
    const rows: string[][] = [];
    let currentGroup: string[] = [];
    let currentVal = '';
    let inString = false;
    let inStringChar = '';
    let inBracketsDepth = 0;
    let inParensDepth = 0;
    let i = 0;

    while (i < valuesPart.length) {
        const char = valuesPart[i];

        if (inString) {
            currentVal += char;
            if (char === "'" && valuesPart[i + 1] === "'") {
                currentVal += "'";
                i += 2;
                continue;
            } else if (char === inStringChar) {
                inString = false;
            }
            i++;
            continue;
        }

        if (char === "'" || char === '"') {
            inString = true;
            inStringChar = char;
            currentVal += char;
            i++;
            continue;
        }

        if (inParensDepth > 0) {
            if (char === '(') {
                inParensDepth++;
                currentVal += char;
            } else if (char === ')') {
                inParensDepth--;
                if (inParensDepth === 0) {
                    currentGroup.push(currentVal.trim());
                    rows.push(currentGroup);
                    currentGroup = [];
                    currentVal = '';
                } else {
                    currentVal += char;
                }
            } else if (char === ',' && inParensDepth === 1 && inBracketsDepth === 0) {
                currentGroup.push(currentVal.trim());
                currentVal = '';
            } else {
                if (char === '[') inBracketsDepth++;
                else if (char === ']') inBracketsDepth--;
                currentVal += char;
            }
            i++;
            continue;
        }

        if (char === '(') {
            inParensDepth = 1;
            currentVal = '';
            currentGroup = [];
        }
        i++;
    }

    // Convert raw value strings to JS objects
    return rows.map((rowValues, rowIndex) => {
        if (rowValues.length !== columns.length) {
            throw new Error(`Row ${rowIndex} value count (${rowValues.length}) does not match column count (${columns.length})`);
        }
        const obj: any = {};
        columns.forEach((col, colIndex) => {
            obj[col] = convertValue(rowValues[colIndex]);
        });
        return obj;
    });
}

async function runImport() {
    const publicDir = path.resolve(process.cwd(), 'public');

    try {
        // 1. Import m_units
        console.log('🔄 Importing m_units...');
        const units = parseSqlFileToObjects(path.join(publicDir, 'm_units_rows_clean.sql'));
        console.log(`Parsed ${units.length} units.`);
        const { error: unitsErr } = await supabase.from('m_units').upsert(units, { onConflict: 'id' });
        if (unitsErr) throw unitsErr;
        console.log('✅ m_units imported successfully!');

        // 2. Import m_kpi_categories
        console.log('🔄 Importing m_kpi_categories...');
        const categories = parseSqlFileToObjects(path.join(publicDir, 'm_kpi_categories_rows_clean.sql'));
        console.log(`Parsed ${categories.length} categories.`);
        const { error: catErr } = await supabase.from('m_kpi_categories').upsert(categories, { onConflict: 'id' });
        if (catErr) throw catErr;
        console.log('✅ m_kpi_categories imported successfully!');

        // 3. Import m_kpi_indicators
        console.log('🔄 Importing m_kpi_indicators...');
        const indicators = parseSqlFileToObjects(path.join(publicDir, 'm_kpi_indicators_rows_clean.sql'));
        console.log(`Parsed ${indicators.length} indicators.`);
        const { error: indErr } = await supabase.from('m_kpi_indicators').upsert(indicators, { onConflict: 'id' });
        if (indErr) throw indErr;
        console.log('✅ m_kpi_indicators imported successfully!');

        // 4. Import m_kpi_sub_indicators
        console.log('🔄 Importing m_kpi_sub_indicators...');
        const subIndicators = parseSqlFileToObjects(path.join(publicDir, 'm_kpi_sub_indicators_rows_clean.sql'));
        console.log(`Parsed ${subIndicators.length} sub-indicators.`);
        const { error: subErr } = await supabase.from('m_kpi_sub_indicators').upsert(subIndicators, { onConflict: 'id' });
        if (subErr) throw subErr;
        console.log('✅ m_kpi_sub_indicators imported successfully!');

        console.log('\n🚀 ALL MASTER DATA IMPORT COMPLETED!');
    } catch (err: any) {
        console.error('❌ Error during import:', err);
        process.exit(1);
    }
}

runImport();
