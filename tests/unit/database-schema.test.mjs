import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import ts from "typescript";

const root = new URL("../../", import.meta.url);

async function loadSchema() {
  const source = await readFile(new URL("db/schema.ts", root), "utf8");
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(
      '"drizzle-orm/sqlite-core"',
      JSON.stringify(import.meta.resolve("drizzle-orm/sqlite-core")),
    );
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("a fresh database created by committed migrations matches the schema and final snapshot", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migrationFiles = (await readdir(new URL("drizzle/", root)))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const name of migrationFiles) {
      database.exec(await readFile(new URL(`drizzle/${name}`, root), "utf8"));
    }
    const journal = JSON.parse(await readFile(new URL("drizzle/meta/_journal.json", root), "utf8"));
    const lastIndex = journal.entries.at(-1).idx;
    const snapshot = JSON.parse(
      await readFile(
        new URL(`drizzle/meta/${String(lastIndex).padStart(4, "0")}_snapshot.json`, root),
        "utf8",
      ),
    );
    const tables = Object.values(await loadSchema()).map(getTableConfig);
    const tableNames = tables.map((table) => table.name).sort();
    assert.deepEqual(Object.keys(snapshot.tables).sort(), tableNames);
    assert.deepEqual(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name),
      tableNames,
    );

    for (const table of tables) {
      const columns = database.prepare(`PRAGMA table_info('${table.name}')`).all();
      const snapshotTable = snapshot.tables[table.name];
      assert.deepEqual(
        columns.map((column) => column.name).sort(),
        table.columns.map((column) => column.name).sort(),
        `${table.name}: migration columns`,
      );
      assert.deepEqual(
        Object.keys(snapshotTable.columns).sort(),
        table.columns.map((column) => column.name).sort(),
        `${table.name}: snapshot columns`,
      );
      for (const column of table.columns) {
        const migrated = columns.find((item) => item.name === column.name);
        const recorded = snapshotTable.columns[column.name];
        assert.equal(
          migrated.type.toLowerCase(),
          column.getSQLType(),
          `${table.name}.${column.name}: SQL type`,
        );
        assert.equal(
          Boolean(migrated.notnull),
          column.notNull,
          `${table.name}.${column.name}: nullable`,
        );
        assert.equal(
          recorded.notNull,
          column.notNull,
          `${table.name}.${column.name}: snapshot nullable`,
        );
        assert.equal(
          recorded.primaryKey,
          column.primary,
          `${table.name}.${column.name}: snapshot primary key`,
        );
        assert.equal(
          recorded.type,
          column.getSQLType(),
          `${table.name}.${column.name}: snapshot type`,
        );
        assert.equal(
          migrated.dflt_value,
          column.default == null ? null : String(column.default),
          `${table.name}.${column.name}: default`,
        );
        assert.equal(
          recorded.default,
          column.default,
          `${table.name}.${column.name}: snapshot default`,
        );
      }
      const indexes = database
        .prepare(`PRAGMA index_list('${table.name}')`)
        .all()
        .filter((index) => index.origin !== "pk");
      assert.deepEqual(
        indexes.map((index) => index.name).sort(),
        table.indexes.map((index) => index.config.name).sort(),
        `${table.name}: migration indexes`,
      );
      assert.deepEqual(
        Object.keys(snapshotTable.indexes).sort(),
        indexes.map((index) => index.name).sort(),
        `${table.name}: snapshot indexes`,
      );
      for (const index of table.indexes) {
        const expectedColumns = index.config.columns.map((column) => column.name);
        assert.deepEqual(
          database
            .prepare(`PRAGMA index_info('${index.config.name}')`)
            .all()
            .map((column) => column.name),
          expectedColumns,
        );
        assert.deepEqual(snapshotTable.indexes[index.config.name].columns, expectedColumns);
      }
    }
  } finally {
    database.close();
  }
});
