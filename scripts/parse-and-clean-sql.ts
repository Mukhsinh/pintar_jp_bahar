import * as fs from 'fs';
import * as path from 'path';

function parseSqlInsert(filePath: string, removeColumns: string[] = []): string {
    console.log(`Processing file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Match the INSERT INTO part and extract columns and values
    // e.g. INSERT INTO "public"."m_kpi_indicators" ("col1", "col2") VALUES (val1, val2), (val3, val4);
    const insertRegexp = /INSERT\s+INTO\s+([^\s(]+)\s*\(([^)]+)\)\s*VALUES\s*/i;
    const match = content.match(insertRegexp);
    if (!match) {
        throw new Error(`Failed to parse insert statement in ${filePath}`);
    }

    const tableName = match[1];
    const columnsStr = match[2];
    const valuesStartIndex = match.index! + match[0].length;
    const valuesPart = content.slice(valuesStartIndex).trim();

    // Parse columns
    const columns = columnsStr.split(',').map(c => c.trim().replace(/"/g, ''));
    console.log(`Found columns: ${columns.join(', ')}`);

    // Identify indices of columns to remove
    const removeIndices = new Set<number>();
    removeColumns.forEach(col => {
        const idx = columns.indexOf(col);
        if (idx !== -1) {
            removeIndices.add(idx);
        }
    });

    const targetColumns = columns.filter((_, idx) => !removeIndices.has(idx));
    console.log(`Target columns will be: ${targetColumns.join(', ')}`);

    // Parse values row by row
    const rows: string[][] = [];
    let currentGroup: string[] = [];
    let currentVal = '';
    let inString = false;
    let inStringChar = '';
    let inBracketsDepth = 0;
    let inParensDepth = 0;
    let i = 0;

    // Let's scroll through the valuesPart char by char
    while (i < valuesPart.length) {
        const char = valuesPart[i];

        if (inString) {
            currentVal += char;
            // Handle escaped single quote in pg (e.g. '')
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

        // Inside parens (a row)
        if (inParensDepth > 0) {
            if (char === '(') {
                inParensDepth++;
                currentVal += char;
            } else if (char === ')') {
                inParensDepth--;
                if (inParensDepth === 0) {
                    // Finished a row value
                    currentGroup.push(currentVal.trim());
                    rows.push(currentGroup);
                    currentGroup = [];
                    currentVal = '';
                } else {
                    currentVal += char;
                }
            } else if (char === ',' && inParensDepth === 1 && inBracketsDepth === 0) {
                // Top-level value separator within the row
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

        // Outside parens, find the start of the next row '('
        if (char === '(') {
            inParensDepth = 1;
            currentVal = '';
            currentGroup = [];
        }
        i++;
    }

    console.log(`Parsed ${rows.length} rows`);

    // Filter the rows' values
    const cleanRows = rows.map(row => {
        if (row.length !== columns.length) {
            throw new Error(`Row value length (${row.length}) does not match columns length (${columns.length})! Row snippet: ${row.slice(0, 3).join(', ')}...`);
        }
        const filteredRow = row.filter((_, idx) => !removeIndices.has(idx));
        return `(${filteredRow.join(', ')})`;
    });

    const columnsListStr = targetColumns.map(c => `"${c}"`).join(', ');
    const valuesJoin = cleanRows.join(',\n  ');

    return `INSERT INTO ${tableName} (${columnsListStr}) VALUES \n  ${valuesJoin}\nON CONFLICT (id) DO NOTHING;`;
}

async function main() {
    const publicDir = path.resolve(process.cwd(), 'public');

    // 1. Process m_units
    try {
        const cleanSql = parseSqlInsert(path.join(publicDir, 'm_units_rows.sql'));
        fs.writeFileSync(path.join(publicDir, 'm_units_rows_clean.sql'), cleanSql);
        console.log('✅ Created m_units_rows_clean.sql');
    } catch (err: any) {
        console.error('❌ Error processing m_units:', err.message);
    }

    // 2. Process m_kpi_categories
    try {
        const cleanSql = parseSqlInsert(path.join(publicDir, 'm_kpi_categories_rows (1).sql'));
        fs.writeFileSync(path.join(publicDir, 'm_kpi_categories_rows_clean.sql'), cleanSql);
        console.log('✅ Created m_kpi_categories_rows_clean.sql');
    } catch (err: any) {
        console.error('❌ Error processing m_kpi_categories:', err.message);
    }

    // 3. Process m_kpi_indicators
    try {
        const cleanSql = parseSqlInsert(path.join(publicDir, 'm_kpi_indicators_rows (1).sql'), ['service_types', 'measurement_type', 'unit_tariff']);
        fs.writeFileSync(path.join(publicDir, 'm_kpi_indicators_rows_clean.sql'), cleanSql);
        console.log('✅ Created m_kpi_indicators_rows_clean.sql');
    } catch (err: any) {
        console.error('❌ Error processing m_kpi_indicators:', err.message);
    }

    // 4. Process m_kpi_sub_indicators
    try {
        const cleanSql = parseSqlInsert(path.join(publicDir, 'm_kpi_sub_indicators_rows (1).sql'));
        fs.writeFileSync(path.join(publicDir, 'm_kpi_sub_indicators_rows_clean.sql'), cleanSql);
        console.log('✅ Created m_kpi_sub_indicators_rows_clean.sql');
    } catch (err: any) {
        console.error('❌ Error processing m_kpi_sub_indicators:', err.message);
    }
}

main();
