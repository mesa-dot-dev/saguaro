import { afterAll, describe, expect, test } from 'bun:test';
import { resetTreeSitter } from '../../init.js';
import { extractRust } from '../rust.js';

describe('rust extractor', () => {
  afterAll(() => resetTreeSitter());

  test('extracts simple use statement', async () => {
    const result = await extractRust('use std::io::Read;\n');
    expect(result.language).toBe('rust');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('std::io');
    expect(result.imports[0].symbols).toEqual(['Read']);
    expect(result.imports[0].kind).toBe('named');
  });

  test('extracts grouped use statement', async () => {
    const result = await extractRust('use std::io::{Read, Write};\n');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('std::io');
    expect(result.imports[0].symbols).toContain('Read');
    expect(result.imports[0].symbols).toContain('Write');
    expect(result.imports[0].kind).toBe('named');
  });

  test('extracts wildcard use', async () => {
    const result = await extractRust('use std::io::prelude::*;\n');
    expect(result.imports[0].kind).toBe('wildcard');
    expect(result.imports[0].source).toBe('std::io::prelude');
  });

  test('extracts simple wildcard', async () => {
    const result = await extractRust('use foo::*;\n');
    expect(result.imports[0].kind).toBe('wildcard');
    expect(result.imports[0].source).toBe('foo');
  });

  test('extracts crate-local use', async () => {
    const result = await extractRust('use crate::utils::helpers;\n');
    expect(result.imports[0].source).toBe('crate::utils');
    expect(result.imports[0].symbols).toEqual(['helpers']);
  });

  test('extracts super use', async () => {
    const result = await extractRust('use super::bar;\n');
    expect(result.imports[0].source).toBe('super');
    expect(result.imports[0].symbols).toEqual(['bar']);
  });

  test('extracts use-as by original name', async () => {
    const result = await extractRust('use std::io::Read as IoRead;\n');
    expect(result.imports[0].source).toBe('std::io');
    expect(result.imports[0].symbols).toEqual(['Read']);
  });

  test('only exports pub items', async () => {
    const code = `
pub fn serve(addr: &str) -> Result<(), Error> {
    Ok(())
}

fn helper() {}

pub struct Config {
    pub name: String,
}

struct Internal;

pub trait Handler {
    fn handle(&self);
}

pub enum Status {
    Active,
    Inactive,
}

pub const MAX_RETRIES: u32 = 3;
const INTERNAL_LIMIT: u32 = 10;

pub type Callback = Box<dyn Fn()>;

pub static GLOBAL: u32 = 0;
`;
    const result = await extractRust(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('serve');
    expect(names).toContain('Config');
    expect(names).toContain('Handler');
    expect(names).toContain('Status');
    expect(names).toContain('MAX_RETRIES');
    expect(names).toContain('Callback');
    expect(names).toContain('GLOBAL');
    expect(names).not.toContain('helper');
    expect(names).not.toContain('Internal');
    expect(names).not.toContain('INTERNAL_LIMIT');
  });

  test('extracts function signatures', async () => {
    const code = `pub fn serve(addr: &str, port: u16) -> Result<(), Error> {\n    Ok(())\n}\n`;
    const result = await extractRust(code);
    expect(result.exports[0].signature).toContain('pub fn serve');
  });

  test('maps kinds correctly', async () => {
    const code = `
pub fn f() {}
pub struct S;
pub trait T {}
pub enum E {}
pub type A = u32;
pub const C: u32 = 1;
pub static G: u32 = 0;
`;
    const result = await extractRust(code);
    const kindMap = Object.fromEntries(result.exports.map((e) => [e.name, e.kind]));
    expect(kindMap.f).toBe('function');
    expect(kindMap.S).toBe('class');
    expect(kindMap.T).toBe('trait');
    expect(kindMap.E).toBe('enum');
    expect(kindMap.A).toBe('type');
    expect(kindMap.C).toBe('constant');
    expect(kindMap.G).toBe('variable');
  });
});
