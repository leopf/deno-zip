import { decode, encode } from "https://deno.land/std@0.74.0/encoding/utf8.ts";
import { join } from "https://deno.land/std@0.74.0/path/mod.ts";
import { assert, assertEquals, assertThrowsAsync } from "https://deno.land/std@0.74.0/testing/asserts.ts";
import { JSZip, readZip, zipDir } from "./mod.ts";
import { exists } from "https://deno.land/std@0.100.0/fs/mod.ts";

// FIXME use tmp directory and clean up.
async function exampleZip(path: string, createDirectories = true) {
  const zip = new JSZip();
  zip.addFile("Hello.txt", "Hello World\n");

  if (createDirectories) {
    const img = zip.folder("images");
    img.addFile("smile.gif", "\0", { base64: true });
  }
  else {
    // Use backslashed for edge case where directory is missing.
    zip.addFile("images\\smile.gif", "\0", { base64: true })
  }

  await zip.writeZip(path);
}

// Used for testing path exploits
async function pathExploitExampleZip() {
  const zip = new JSZip();
  zip.addFile("../Hello.txt", "Hello World\n");

  const tempFileName = await Deno.makeTempFile({
    suffix: ".zip"
  });

  await zip.writeZip(tempFileName);
  return tempFileName;
}

async function fromDir<T>(dir: string, f: () => Promise<T>) {
  const cwd = Deno.cwd();
  Deno.chdir(dir);
  try {
    return await f();
  } finally {
    Deno.chdir(cwd);
  }
}

async function exampleDir(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await fromDir(dir, async () => {
    await Deno.writeFile("Hello.txt", encode("Hello World\n"));
    await Deno.mkdir("images");
    Deno.chdir("images");
    await Deno.writeFile("smile.gif", encode("\0"));
  });
  return dir;
}

Deno.test("read", async () => {
  await exampleZip("example.zip");

  const z = await readZip("example.zip");
  assertEquals(z.file("Hello.txt").name, "Hello.txt");

  let i = 0;
  for (const f of z) i++;
  assertEquals(i, 3);

  assertEquals("Hello World\n", await z.file("Hello.txt").async("string"));

  await Deno.remove("example.zip");
});

// TODO add tests for unzip

Deno.test("dir", async () => {
  const dir = await exampleDir();
  const z = await zipDir(dir);

  assertEquals(z.file("Hello.txt").name, "Hello.txt");
  assertEquals("Hello World\n", await z.file("Hello.txt").async("string"));

  const img = z.folder("images");
  assertEquals(img.file("smile.gif").name, "images/smile.gif");
});

Deno.test("unzip", async () => {
  const dir = await Deno.makeTempDir();
  await exampleZip("example.zip");
  const z = await readZip("example.zip");
  await z.unzip(dir);

  const content = await Deno.readFile(join(dir, "Hello.txt"));
  assertEquals("Hello World\n", decode(content));

  const smile = await Deno.readFile(join(dir, "images", "smile.gif"));
  assertEquals("", decode(smile));
});

Deno.test("unzip without dir", async () => {
  const dir = await Deno.makeTempDir();

  await exampleZip("example.zip", false);
  const z = await readZip("example.zip");
  await z.unzip(dir);

  const content = await Deno.readFile(join(dir, "Hello.txt"));
  assertEquals("Hello World\n", decode(content));

  const smile = await Deno.readFile(join(dir, "images", "smile.gif"));
  assertEquals("", decode(smile));
});

Deno.test("unzip exploit test", async () => {
  const dir = await Deno.makeTempDir();
  const unpackDir = join(dir, "unpack");
  await Deno.mkdir(unpackDir);

  const zipFile = await pathExploitExampleZip();
  const z = await readZip(zipFile);

  await Deno.remove(zipFile);

  assertThrowsAsync(async () => await z.unzip(unpackDir));
  assert(!(await exists(join(dir, "Hello.txt"))));

  await Deno.remove(dir, {
    recursive: true
  });
});