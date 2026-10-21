import { clip } from '../ir.js';
import { toSnake } from '../analyzer.js';
import { buildUnit } from './model.js';
import { PRINTERS } from './printers.js';

// Rule-based structural translator: legacy IR -> modern project files.

export function slugify(name) {
  return String(name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^\d+/, '') || 'app';
}

const kebab = (s) => toSnake(s).replace(/_/g, '-');

function header(unit, commentStart, commentLine, commentEnd) {
  const m = unit.mod;
  return [
    commentStart,
    `${commentLine}${unit.className}: modernized from ${m.file} (${m.language.toUpperCase()} ${m.kind} ${m.name}).`,
    `${commentLine}Rule-based structural translation: control flow and data layout mirror the legacy code.`,
    `${commentLine}Resolve any manual-translation TODO markers before merging.`,
    commentEnd,
  ].filter((x) => x !== null);
}

function procDoc(m) {
  const p = m.legacy;
  const where = `${m.metrics?.file || ''} lines ${p.loc.start}-${p.loc.end}`.trim();
  const cc = m.metrics ? `, cyclomatic complexity ${m.metrics.complexity}` : '';
  return `${p.name} (${where}${cc})`;
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

function javaFile(unit, p, ctx) {
  const cls = unit.className;
  const body = [];
  const emit = (lines) => body.push(...lines);
  p.level = 1;
  // records
  for (const rec of unit.records) {
    p.line(`/** ${rec.legacyName} */`);
    p.line(`public static class ${rec.name} {`);
    p.indented(() => {
      for (const f of rec.fields) p.line(`public ${p.typeName(f.type)} ${f.name} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)};${p.fieldComment(f)}`);
    });
    p.line('}');
    p.line();
  }
  for (const f of unit.fields) {
    const mods = f.isConst ? 'private static final' : f.isStatic ? 'private static' : 'private';
    p.line(`${mods} ${p.typeName(f.type)} ${f.name} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)};${p.fieldComment(f)}`);
  }
  for (const m of unit.staticInits) {
    p.line();
    p.line(`/** ${procDoc(m)} */`);
    p.line('static {');
    p.indented(() => {
      p.staticContext = true;
      p.body(m);
      p.staticContext = false;
    });
    p.line('}');
  }
  p.imports.add('java.io.PrintStream');
  p.line('private PrintStream out = System.out;');
  p.line();
  p.line(`public ${cls} withOutput(PrintStream out) {`);
  p.indented(() => {
    p.line('this.out = out;');
    p.line('return this;');
  });
  p.line('}');
  const hasRunMethod = unit.methods.some((m) => m.name === 'run');
  if (unit.runSequence.length && !hasRunMethod) {
    p.line();
    p.line('/** Program entry: executes the legacy paragraphs in their original order. */');
    p.line('public void run() {');
    p.indented(() => {
      if (unit.usesStopRun) {
        p.line('try {');
        p.indented(() => unit.runSequence.forEach((n) => p.line(`${n}();`)));
        p.line('} catch (StopRun stop) {');
        p.indented(() => p.line('// STOP RUN: normal termination'));
        p.line('}');
      } else unit.runSequence.forEach((n) => p.line(`${n}();`));
    });
    p.line('}');
  }
  for (const m of unit.methods) {
    p.line();
    p.line(`/** ${procDoc(m)} */`);
    const params = m.params.map((x) => `${p.typeName(x.type)} ${x.name}`).join(', ');
    if (m.isConstructor) p.line(`public ${cls}(${params}) {`);
    else p.line(`${m.visibility === 'private' ? 'private' : 'public'}${m.isStatic ? ' static' : ''}${m.legacy.isSynchronized ? ' synchronized' : ''} ${m.returns ? p.typeName(m.returns) : 'void'} ${m.name}(${params}) {`);
    p.indented(() => {
      p.staticContext = m.isStatic;
      p.body(m);
      p.staticContext = false;
    });
    p.line('}');
  }
  const hasMain = unit.methods.some((m) => m.name === 'main' && m.isStatic);
  if (unit.runSequence.length && !hasMain) {
    p.line();
    p.line('public static void main(String[] args) {');
    p.indented(() => p.line(`new ${cls}().run();`));
    p.line('}');
  }
  // helpers
  if (p.helpers.has('scale')) {
    p.imports.add('java.math.RoundingMode');
    p.line();
    p.line('/** COBOL stores results at the receiving field\'s scale: truncated, or rounded half-up for ROUNDED. */');
    p.line('private static BigDecimal scale(BigDecimal value, int scale, boolean round) {');
    p.indented(() => p.line('return value.setScale(scale, round ? RoundingMode.HALF_UP : RoundingMode.DOWN);'));
    p.line('}');
  }
  if (p.helpers.has('cobolNum')) {
    p.imports.add('java.math.RoundingMode');
    p.imports.add('java.math.BigDecimal');
    p.line();
    p.line('/** COBOL DISPLAY of a numeric field: zero-padded digits with an implied decimal point. */');
    p.line('private static String cobolNum(BigDecimal value, int digits, int scale) {');
    p.indented(() => {
      p.line('String raw = value.abs().setScale(scale, RoundingMode.DOWN).movePointRight(scale).toBigInteger().toString();');
      p.line('if (raw.length() > digits) raw = raw.substring(raw.length() - digits);');
      p.line('String padded = "0".repeat(digits - raw.length()) + raw;');
      p.line('return value.signum() < 0 ? "-" + padded : padded;');
    });
    p.line('}');
  }
  if (p.helpers.has('pad')) {
    p.line();
    p.line('/** COBOL alphanumeric fields are fixed length: pad with spaces or truncate. */');
    p.line('private static String pad(String value, int length) {');
    p.indented(() => {
      p.line('String v = value == null ? "" : value;');
      p.line('return v.length() >= length ? v.substring(0, length) : v + " ".repeat(length - v.length());');
    });
    p.line('}');
  }
  if (p.helpers.has('endOfFile')) {
    p.line();
    p.line('/** COBOL READ ... AT END: wire READ to the modern file or database API and report end-of-file here. */');
    p.line('private static boolean endOfFile(String file) {');
    p.indented(() => p.line('throw new UnsupportedOperationException("READ ... AT END is not translated yet for " + file);'));
    p.line('}');
  }
  if (unit.usesStopRun) {
    p.line();
    p.line('/** Raised by STOP RUN inside a nested paragraph and caught by run(). */');
    p.line('private static final class StopRun extends RuntimeException {');
    p.indented(() => p.line('StopRun() { super(null, null, false, false); }'));
    p.line('}');
  }
  emit(p.lines);
  const annotations = ctx.framework === 'spring-boot' ? ['@Service'] : [];
  if (ctx.framework === 'spring-boot') p.imports.add('org.springframework.stereotype.Service');
  const importLines = [...p.imports].filter((i) => i.includes('.')).sort().map((i) => `import ${i};`);
  return [
    `package ${ctx.javaPackage};`,
    '',
    ...importLines,
    ...(importLines.length ? [''] : []),
    ...header(unit, '/**', ' * ', ' */'),
    ...annotations,
    `public class ${cls} {`,
    ...body,
    '}',
    '',
  ].join('\n');
}

function javaTest(unit, ctx) {
  const cls = unit.className;
  const runnable = unit.runSequence.length || unit.methods.some((m) => m.name === 'run');
  const lines = [
    `package ${ctx.javaPackage};`,
    '',
    'import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;',
    'import static org.junit.jupiter.api.Assertions.assertEquals;',
    'import static org.junit.jupiter.api.Assumptions.assumeTrue;',
    '',
    'import java.io.ByteArrayOutputStream;',
    'import java.io.PrintStream;',
    'import org.junit.jupiter.api.Test;',
    '',
    `/** Characterization tests for ${cls} (legacy ${unit.mod.file}). */`,
    `class ${cls}Test {`,
    '    // Paste the legacy program\'s console output here to lock in its behaviour.',
    '    private static final String EXPECTED_OUTPUT = null;',
    '',
    '    private String captureRun() {',
    '        ByteArrayOutputStream buffer = new ByteArrayOutputStream();',
    runnable ? `        new ${cls}().withOutput(new PrintStream(buffer, true)).run();` : `        ${cls}.main(new String[0]);`,
    '        return buffer.toString();',
    '    }',
    '',
    '    @Test',
    '    void runsToCompletion() {',
    '        assertDoesNotThrow(this::captureRun);',
    '    }',
    '',
    '    @Test',
    '    void matchesLegacyOutput() {',
    '        assumeTrue(EXPECTED_OUTPUT != null, "Record the legacy output first");',
    '        assertEquals(EXPECTED_OUTPUT, captureRun());',
    '    }',
    '}',
    '',
  ];
  if (!runnable && !unit.methods.some((m) => m.name === 'main' && m.isStatic)) {
    return lines.join('\n').replace(`        ${cls}.main(new String[0]);`, `        new ${cls}().withOutput(new PrintStream(buffer, true));`);
  }
  return lines.join('\n');
}

function javaProjectFiles(units, ctx) {
  const artifact = ctx.slug;
  const files = [];
  const spring = ctx.framework === 'spring-boot';
  files.push({
    path: 'pom.xml',
    language: 'xml',
    kind: 'config',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
${spring ? `  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
  </parent>
` : ''}  <groupId>com.modernized</groupId>
  <artifactId>${artifact}</artifactId>
  <version>1.0.0</version>
  <properties>
    <java.version>21</java.version>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
${spring ? `    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
` : `    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.3</version>
      <scope>test</scope>
    </dependency>
`}  </dependencies>
  <build>
    <plugins>
${spring ? `      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
` : `      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
`}    </plugins>
  </build>
</project>
`,
  });
  if (spring) {
    const dir = `src/main/java/${ctx.javaPackage.replace(/\./g, '/')}`;
    const runnable = units.filter((u) => u.runSequence.length || u.methods.some((m) => m.name === 'run'));
    files.push({
      path: `${dir}/Application.java`,
      language: 'java',
      kind: 'source',
      content: `package ${ctx.javaPackage};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`,
    });
    files.push({
      path: `${dir}/ModernizationController.java`,
      language: 'java',
      kind: 'source',
      content: `package ${ctx.javaPackage};

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Exposes each modernized program as an HTTP endpoint that returns its console output. */
@RestController
@RequestMapping("/api")
public class ModernizationController {

    @GetMapping("/programs")
    public List<String> programs() {
        return List.of(${runnable.map((u) => `"${kebab(u.className)}"`).join(', ')});
    }
${runnable
  .map(
    (u) => `
    @PostMapping("/${kebab(u.className)}/run")
    public Map<String, Object> run${u.className}() {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        new ${u.className}().withOutput(new PrintStream(buffer, true, StandardCharsets.UTF_8)).run();
        String output = buffer.toString(StandardCharsets.UTF_8);
        return Map.of("program", "${u.className}", "lines", Arrays.asList(output.split("\\\\R")));
    }
`,
  )
  .join('')}}
`,
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

function csharpFile(unit, p, ctx) {
  const cls = unit.className;
  p.level = 1;
  for (const rec of unit.records) {
    p.line(`/// <summary>${rec.legacyName}</summary>`);
    p.line(`public class ${rec.name}`);
    p.line('{');
    p.indented(() => {
      for (const f of rec.fields) p.line(`public ${p.typeName(f.type)} ${f.name} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)};${p.fieldComment(f)}`);
    });
    p.line('}');
    p.line();
  }
  for (const f of unit.fields) {
    const constable = f.isConst && ['int', 'long', 'decimal', 'float', 'string', 'bool'].includes(f.type?.t);
    const mods = constable ? 'private const' : f.isConst ? 'private static readonly' : f.isStatic ? 'private static' : 'private';
    p.line(`${mods} ${p.typeName(f.type)} ${f.name} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)};${p.fieldComment(f)}`);
  }
  // C# allows one static constructor, so every legacy static block goes into it in source order.
  if (unit.staticInits.length) {
    p.line();
    p.line(`/// <summary>${unit.staticInits.map((m) => procDoc(m)).join('; ').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</summary>`);
    p.line(`static ${cls}()`);
    p.line('{');
    p.indented(() => {
      p.staticContext = true;
      unit.staticInits.forEach((m) => p.body(m));
      p.staticContext = false;
    });
    p.line('}');
  }
  p.line('private TextWriter _out = Console.Out;');
  p.line();
  p.line(`public ${cls} WithOutput(TextWriter output)`);
  p.line('{');
  p.indented(() => {
    p.line('_out = output;');
    p.line('return this;');
  });
  p.line('}');
  const hasRun = unit.methods.some((m) => m.name === 'Run');
  if (unit.runSequence.length && !hasRun) {
    p.line();
    p.line('/// <summary>Program entry: executes the legacy paragraphs in their original order.</summary>');
    p.line('public void Run()');
    p.line('{');
    p.indented(() => {
      if (unit.usesStopRun) {
        p.line('try');
        p.line('{');
        p.indented(() => unit.runSequence.forEach((n) => p.line(`${n}();`)));
        p.line('}');
        p.line('catch (StopRunException)');
        p.line('{');
        p.indented(() => p.line('// STOP RUN: normal termination'));
        p.line('}');
      } else unit.runSequence.forEach((n) => p.line(`${n}();`));
    });
    p.line('}');
  }
  for (const m of unit.methods) {
    p.line();
    p.line(`/// <summary>${procDoc(m).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</summary>`);
    const params = m.params.map((x) => `${x.byRef && unit.language === 'vb6' ? 'ref ' : ''}${p.typeName(x.type)} ${x.name}`).join(', ');
    if (m.isConstructor) p.line(`public ${cls}(${params})`);
    else p.line(`${m.visibility === 'private' ? 'private' : 'public'}${m.isStatic ? ' static' : ''} ${m.returns ? p.typeName(m.returns) : 'void'} ${m.name}(${params})`);
    p.line('{');
    p.indented(() => {
      p.staticContext = m.isStatic;
      p.body(m);
      p.staticContext = false;
    });
    p.line('}');
  }
  if (p.helpers.has('scale')) {
    p.line();
    p.line('/// <summary>COBOL stores results at the receiving field\'s scale: truncated, or rounded half-up for ROUNDED.</summary>');
    p.line('private static decimal Scale(decimal value, int scale, bool round)');
    p.line('{');
    p.indented(() => {
      p.line('decimal factor = 1m;');
      p.line('for (int i = 0; i < scale; i++) factor *= 10m;');
      p.line('return round ? Math.Round(value, scale, MidpointRounding.AwayFromZero) : Math.Truncate(value * factor) / factor;');
    });
    p.line('}');
  }
  if (p.helpers.has('cobolNum')) {
    p.line();
    p.line('/// <summary>COBOL DISPLAY of a numeric field: zero-padded digits with an implied decimal point.</summary>');
    p.line('private static string CobolNum(decimal value, int digits, int scale)');
    p.line('{');
    p.indented(() => {
      p.line('decimal factor = 1m;');
      p.line('for (int i = 0; i < scale; i++) factor *= 10m;');
      p.line('string raw = Math.Truncate(Math.Abs(value) * factor).ToString("0");');
      p.line('if (raw.Length > digits) raw = raw[^digits..];');
      p.line('return (value < 0 ? "-" : "") + raw.PadLeft(digits, \'0\');');
    });
    p.line('}');
  }
  if (p.helpers.has('pad')) {
    p.line();
    p.line('/// <summary>COBOL alphanumeric fields are fixed length: pad with spaces or truncate.</summary>');
    p.line('private static string Pad(string value, int length) => (value ?? "").Length >= length ? (value ?? "")[..length] : (value ?? "").PadRight(length);');
  }
  if (p.helpers.has('endOfFile')) {
    p.line();
    p.line('/// <summary>COBOL READ ... AT END: wire READ to the modern file or database API and report end-of-file here.</summary>');
    p.line('private static bool EndOfFile(string file) => throw new NotSupportedException($"READ ... AT END is not translated yet for {file}");');
  }
  if (unit.usesStopRun) {
    p.line();
    p.line('private sealed class StopRunException : Exception { }');
  }
  if (p.helpers.has('enumeration')) {
    p.line();
    p.line('/// <summary>Legacy Enumeration shim over IEnumerable.</summary>');
    p.line('private sealed class LegacyEnumeration');
    p.line('{');
    p.indented(() => {
      p.line('private readonly System.Collections.IEnumerator _it;');
      p.line('private bool _has;');
      p.line('public LegacyEnumeration(System.Collections.IEnumerable source) { _it = source.GetEnumerator(); _has = _it.MoveNext(); }');
      p.line('public bool HasMoreElements() => _has;');
      p.line('public object NextElement() { var v = _it.Current; _has = _it.MoveNext(); return v; }');
    });
    p.line('}');
  }
  const body = p.lines;
  return [
    'using System;',
    'using System.Collections.Generic;',
    'using System.IO;',
    'using System.Linq;',
    'using System.Text;',
    '',
    `namespace ${ctx.csNamespace};`,
    '',
    ...header(unit, '/// <summary>', '/// ', '/// </summary>'),
    `public class ${cls}`,
    '{',
    ...body,
    '}',
    '',
  ].join('\n');
}

function csharpTest(unit, ctx) {
  const cls = unit.className;
  const runnable = unit.runSequence.length || unit.methods.some((m) => m.name === 'Run');
  return `using System.IO;
using Xunit;

namespace ${ctx.csNamespace}.Tests;

/// <summary>Characterization tests for ${cls} (legacy ${unit.mod.file}).</summary>
public class ${cls}Tests
{
    // Paste the legacy program's console output here to lock in its behaviour.
    private const string? ExpectedOutput = null;

    private static string CaptureRun()
    {
        var writer = new StringWriter();
        ${runnable ? `new ${cls}().WithOutput(writer).Run();` : `new ${cls}().WithOutput(writer);`}
        return writer.ToString();
    }

    [Fact]
    public void RunsToCompletion()
    {
        var output = CaptureRun();
        Assert.NotNull(output);
    }

    [Fact]
    public void MatchesLegacyOutput()
    {
        if (ExpectedOutput is null) return; // record the legacy output first
        Assert.Equal(ExpectedOutput, CaptureRun());
    }
}
`;
}

function csharpProjectFiles(units, ctx) {
  const web = ctx.framework === 'aspnet';
  const files = [
    {
      path: `src/${ctx.csNamespace}/${ctx.csNamespace}.csproj`,
      language: 'xml',
      kind: 'config',
      content: `<Project Sdk="${web ? 'Microsoft.NET.Sdk.Web' : 'Microsoft.NET.Sdk'}">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>${ctx.csNamespace}</RootNamespace>
  </PropertyGroup>
</Project>
`,
    },
    {
      path: `tests/${ctx.csNamespace}.Tests/${ctx.csNamespace}.Tests.csproj`,
      language: 'xml',
      kind: 'config',
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/${ctx.csNamespace}/${ctx.csNamespace}.csproj" />
  </ItemGroup>
</Project>
`,
    },
  ];
  if (web) {
    const runnable = units.filter((u) => u.runSequence.length || u.methods.some((m) => m.name === 'Run'));
    files.push({
      path: `src/${ctx.csNamespace}/Program.cs`,
      language: 'csharp',
      kind: 'source',
      content: `using ${ctx.csNamespace};

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/api/programs", () => new[] { ${runnable.map((u) => `"${kebab(u.className)}"`).join(', ')} });
${runnable
  .map(
    (u) => `app.MapPost("/api/${kebab(u.className)}/run", () =>
{
    var writer = new StringWriter();
    new ${u.className}().WithOutput(writer).Run();
    return Results.Ok(new { program = "${u.className}", lines = writer.ToString().Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries) });
});
`,
  )
  .join('')}
app.Run();
`,
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

function tsFile(unit, p, ctx) {
  const cls = unit.className;
  const out = [];
  p.level = 0;
  for (const rec of unit.records) {
    p.line(`/** ${rec.legacyName} */`);
    p.line(`export class ${rec.name} {`);
    p.indented(() => {
      for (const f of rec.fields) p.line(`${f.name}: ${p.typeName(f.type)} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)};${p.fieldComment(f)}`);
    });
    p.line('}');
    p.line();
  }
  out.push(...p.lines);
  p.lines = [];
  p.level = 1;
  for (const f of unit.fields) {
    const mods = f.isConst ? 'static readonly' : f.isStatic ? 'private static' : 'private';
    p.line(`${mods} ${f.name}: ${p.typeName(f.type)} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)};${p.fieldComment(f)}`);
  }
  for (const m of unit.staticInits) {
    p.line();
    p.line(`/** ${procDoc(m)} */`);
    p.line('static {');
    p.indented(() => {
      p.staticContext = true;
      p.body(m);
      p.staticContext = false;
    });
    p.line('}');
  }
  p.line('private out: (text: string) => void = (text) => {');
  p.indented(() => p.line('process.stdout.write(text);'));
  p.line('};');
  p.line();
  p.line('withOutput(out: (text: string) => void): this {');
  p.indented(() => {
    p.line('this.out = out;');
    p.line('return this;');
  });
  p.line('}');
  const hasRun = unit.methods.some((m) => m.name === 'run');
  if (unit.runSequence.length && !hasRun) {
    p.line();
    p.line('/** Program entry: executes the legacy paragraphs in their original order. */');
    p.line('run(): void {');
    p.indented(() => {
      if (unit.usesStopRun) {
        p.line('try {');
        p.indented(() => unit.runSequence.forEach((n) => p.line(`this.${n}();`)));
        p.line('} catch (e) {');
        p.indented(() => p.line('if (!(e instanceof StopRun)) throw e;'));
        p.line('}');
      } else unit.runSequence.forEach((n) => p.line(`this.${n}();`));
    });
    p.line('}');
  }
  for (const m of unit.methods) {
    p.line();
    p.line(`/** ${procDoc(m)} */`);
    const params = m.params.map((x) => `${x.name}: ${p.typeName(x.type)}`).join(', ');
    if (m.isConstructor) p.line(`constructor(${params}) {`);
    else p.line(`${m.visibility === 'private' ? 'private ' : ''}${m.isStatic ? 'static ' : ''}${m.name}(${params}): ${m.returns ? p.typeName(m.returns) : 'void'} {`);
    p.indented(() => {
      p.staticContext = m.isStatic;
      p.body(m);
      p.staticContext = false;
    });
    p.line('}');
  }
  const classBody = p.lines;
  const helpers = [];
  if (p.helpers.has('scale')) {
    helpers.push(
      '/** COBOL stores results at the receiving field\'s scale: truncated, or rounded half-up for ROUNDED. */',
      'function scale(value: number, digits: number, round: boolean): number {',
      '  const factor = 10 ** digits;',
      '  const shifted = Number((value * factor).toFixed(6));',
      '  return (round ? Math.round(shifted) : Math.trunc(shifted)) / factor;',
      '}',
      '',
    );
  }
  if (p.helpers.has('cobolNum')) {
    helpers.push(
      '/** COBOL DISPLAY of a numeric field: zero-padded digits with an implied decimal point. */',
      'function cobolNum(value: number, digits: number, scale: number): string {',
      '  const raw = String(Math.trunc(Number((Math.abs(value) * 10 ** scale).toFixed(6)))).slice(-digits);',
      "  return (value < 0 ? '-' : '') + raw.padStart(digits, '0');",
      '}',
      '',
    );
  }
  if (p.helpers.has('pad')) {
    helpers.push('/** COBOL alphanumeric fields are fixed length: pad with spaces or truncate. */', 'function pad(value: string, length: number): string {', "  return (value ?? '').padEnd(length).slice(0, length);", '}', '');
  }
  if (p.helpers.has('endOfFile')) {
    helpers.push(
      '/** COBOL READ ... AT END: wire READ to the modern file or database API and report end-of-file here. */',
      'function endOfFile(file: string): boolean {',
      '  throw new Error(`READ ... AT END is not translated yet for ${file}`);',
      '}',
      '',
    );
  }
  if (p.helpers.has('sprintf')) {
    helpers.push(
      '/** Minimal printf-style formatter for the legacy format strings. */',
      'function sprintf(format: string, ...args: unknown[]): string {',
      '  let i = 0;',
      "  return format.replace(/%([-0 +#]*)(\\d*)(?:\\.(\\d+))?([dfsxXc%])/g, (_m, flags: string, width: string, precision: string | undefined, conv: string) => {",
      "    if (conv === '%') return '%';",
      '    const arg = args[i++];',
      '    let text: string;',
      "    if (conv === 'f') text = Number(arg).toFixed(precision === undefined ? 6 : Number(precision));",
      "    else if (conv === 'd') text = String(Math.trunc(Number(arg)));",
      "    else if (conv === 'x' || conv === 'X') text = Math.trunc(Number(arg)).toString(16);",
      '    else text = String(arg);',
      "    if (conv === 'X') text = text.toUpperCase();",
      '    const w = Number(width || 0);',
      "    return flags.includes('-') ? text.padEnd(w) : text.padStart(w, flags.includes('0') ? '0' : ' ');",
      '  });',
      '}',
      '',
    );
  }
  if (p.helpers.has('stringBuffer')) {
    helpers.push(
      '/** Legacy StringBuffer shim with chainable append(). */',
      'class StringBuffer {',
      '  private parts: string[] = [];',
      "  constructor(initial = '') {",
      '    if (initial) this.parts.push(initial);',
      '  }',
      '  append(value: unknown): this {',
      '    this.parts.push(String(value));',
      '    return this;',
      '  }',
      '  toString(): string {',
      "    return this.parts.join('');",
      '  }',
      '}',
      '',
    );
  }
  if (p.helpers.has('enumeration')) {
    helpers.push(
      '/** Legacy Enumeration shim over any iterable. */',
      'class Enumeration<T = unknown> {',
      '  private readonly it: Iterator<T>;',
      '  private current: IteratorResult<T>;',
      '  constructor(source: Iterable<T>) {',
      '    this.it = source[Symbol.iterator]();',
      '    this.current = this.it.next();',
      '  }',
      '  hasMoreElements(): boolean {',
      '    return !this.current.done;',
      '  }',
      '  nextElement(): T {',
      '    const value = this.current.value as T;',
      '    this.current = this.it.next();',
      '    return value;',
      '  }',
      '}',
      '',
    );
  }
  if (unit.usesStopRun) helpers.push('/** Raised by STOP RUN inside a nested paragraph and caught by run(). */', 'class StopRun extends Error {}', '');
  const imports = [...(p.refs || [])].map((u) => `import { ${u.className} } from './${ctx.fileStems.get(u)}.js';`);
  return [...header(unit, '/**', ' * ', ' */'), ...imports, ...(imports.length ? [''] : []), ...helpers, ...out, `export class ${cls} {`, ...classBody, '}', ''].join('\n');
}

function tsTest(unit, fileStem) {
  const cls = unit.className;
  const runnable = unit.runSequence.length || unit.methods.some((m) => m.name === 'run');
  return `import { describe, expect, it } from 'vitest';
import { ${cls} } from '../src/${fileStem}';

// Paste the legacy program's console output here to lock in its behaviour.
const EXPECTED_OUTPUT: string | null = null;

function captureRun(): string {
  const chunks: string[] = [];
  ${runnable ? `new ${cls}().withOutput((text) => chunks.push(text)).run();` : `new ${cls}().withOutput((text) => chunks.push(text));`}
  return chunks.join('');
}

describe('${cls} (legacy ${unit.mod.file})', () => {
  it('runs to completion', () => {
    expect(() => captureRun()).not.toThrow();
  });

  it.skipIf(EXPECTED_OUTPUT === null)('matches the legacy output', () => {
    expect(captureRun()).toBe(EXPECTED_OUTPUT);
  });
});
`;
}

function tsProjectFiles(units, ctx) {
  const express = ctx.framework === 'express';
  const runnable = units.filter((u) => u.runSequence.length || u.methods.some((m) => m.name === 'run'));
  const files = [
    {
      path: 'package.json',
      language: 'json',
      kind: 'config',
      content: `${JSON.stringify(
        {
          name: ctx.slug,
          version: '1.0.0',
          private: true,
          type: 'module',
          scripts: { build: 'tsc', test: 'vitest run', ...(express ? { start: 'node dist/server.js', dev: 'tsx src/server.ts' } : { start: 'tsx src/main.ts' }) },
          dependencies: express ? { express: '^4.21.1' } : {},
          devDependencies: { typescript: '^5.6.3', vitest: '^2.1.4', tsx: '^4.19.2', '@types/node': '^22.9.0', ...(express ? { '@types/express': '^5.0.0' } : {}) },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'tsconfig.json',
      language: 'json',
      kind: 'config',
      content: `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, outDir: 'dist', rootDir: 'src', esModuleInterop: true, skipLibCheck: true, types: ['node'] }, include: ['src'] }, null, 2)}\n`,
    },
  ];
  const imports = runnable.map((u) => `import { ${u.className} } from './${ctx.fileStems.get(u)}.js';`).join('\n');
  if (express) {
    files.push({
      path: 'src/server.ts',
      language: 'typescript',
      kind: 'source',
      content: `import express from 'express';
${imports}

const app = express();
app.use(express.json());

const programs: Record<string, () => { run(): void; withOutput(out: (text: string) => void): unknown }> = {
${runnable.map((u) => `  '${kebab(u.className)}': () => new ${u.className}(),`).join('\n')}
};

app.get('/api/programs', (_req, res) => {
  res.json(Object.keys(programs));
});

app.post('/api/:program/run', (req, res) => {
  const factory = programs[req.params.program];
  if (!factory) {
    res.status(404).json({ error: 'Unknown program' });
    return;
  }
  const chunks: string[] = [];
  const program = factory();
  program.withOutput((text) => chunks.push(text));
  program.run();
  res.json({ program: req.params.program, lines: chunks.join('').split('\\n').filter(Boolean) });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(\`Modernized services listening on :\${port}\`));
`,
    });
  } else if (runnable.length) {
    files.push({
      path: 'src/main.ts',
      language: 'typescript',
      kind: 'source',
      content: `${imports}\n\n${runnable.map((u) => `new ${u.className}().run();`).join('\n')}\n`,
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function pyFile(unit, p, ctx) {
  const cls = unit.className;
  const ctor = unit.methods.find((m) => m.isConstructor);
  p.level = 0;
  const recLines = [];
  for (const rec of unit.records) {
    p.line('@dataclass');
    p.line(`class ${rec.name}:`);
    p.indented(() => {
      p.line(`"""${rec.legacyName}"""`);
      for (const f of rec.fields) {
        const def = f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type);
        const value = f.type?.t === 'array' || f.type?.t === 'record' ? `field(default_factory=lambda: ${def})` : def;
        p.line(`${f.name}: ${p.typeName(f.type)} = ${value}${p.fieldComment(f)}`);
      }
    });
    p.line();
    p.line();
  }
  recLines.push(...p.lines);
  p.lines = [];
  p.level = 1;
  p.line(`"""${unit.legacyName}: modernized from ${unit.mod.file}."""`);
  p.line();
  // Constants and Java static fields are class attributes, shared by static and instance methods.
  const consts = unit.fields.filter((f) => f.isConst || f.isStatic);
  for (const f of consts) p.line(`${f.name}: ${p.typeName(f.type)} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)}${p.fieldComment(f)}`);
  if (consts.length) p.line();
  const ctorParams = ctor ? ctor.params.map((x) => `${x.name}: ${p.typeName(x.type)} | None = None`) : [];
  p.line(`def __init__(${['self', ...ctorParams, 'out: TextIO | None = None'].join(', ')}) -> None:`);
  p.indented(() => {
    p.line('self._out = out or sys.stdout');
    for (const f of unit.fields.filter((x) => !x.isConst && !x.isStatic)) p.line(`self.${f.name}: ${p.typeName(f.type)} = ${f.init ? p.coerce(f.init, f.type) : p.defaultValue(f.type)}${p.fieldComment(f)}`);
    if (ctor) {
      p.line(`# legacy constructor: ${procDoc(ctor)}`);
      p.body(ctor);
    }
  });
  const hasRun = unit.methods.some((m) => m.name === 'run');
  if (unit.runSequence.length && !hasRun) {
    p.line();
    p.line('def run(self) -> None:');
    p.indented(() => {
      p.line('"""Program entry: executes the legacy paragraphs in their original order."""');
      if (unit.usesStopRun) {
        p.line('try:');
        p.indented(() => unit.runSequence.forEach((n) => p.line(`self.${n}()`)));
        p.line('except StopRun:');
        p.indented(() => p.line('pass  # STOP RUN: normal termination'));
      } else unit.runSequence.forEach((n) => p.line(`self.${n}()`));
    });
  }
  for (const m of unit.methods) {
    if (m === ctor) continue;
    p.line();
    const params = m.params.map((x) => `${x.name}: ${p.typeName(x.type)}`);
    if (m.isStatic) p.line('@staticmethod');
    const name = m.isConstructor ? `_legacy_init_${m.params.length}` : m.name;
    p.line(`def ${name}(${[...(m.isStatic ? [] : ['self']), ...params].join(', ')}) -> ${m.returns ? p.typeName(m.returns) : 'None'}:`);
    p.indented(() => {
      p.line(`"""${procDoc(m).replace(/"""/g, '')}"""`);
      p.staticContext = m.isStatic;
      p.body(m);
      p.staticContext = false;
    });
  }
  if (unit.staticInits.length) {
    p.line();
    p.line('@staticmethod');
    p.line('def _static_init() -> None:');
    p.indented(() => {
      p.line(`"""${unit.staticInits.map((m) => procDoc(m).replace(/"""/g, '')).join('; ')}; runs once, after the class is defined."""`);
      p.staticContext = true;
      unit.staticInits.forEach((m) => p.body(m));
      p.staticContext = false;
    });
  }
  const classBody = p.lines;
  const helpers = [];
  if (p.helpers.has('scale')) {
    helpers.push(
      'def _scale(value: Decimal | int, digits: int, round_half_up: bool) -> Decimal:',
      '    """COBOL stores results at the receiving field\'s scale: truncated, or rounded half-up for ROUNDED."""',
      '    quantum = Decimal(1).scaleb(-digits)',
      '    return Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP if round_half_up else ROUND_DOWN)',
      '',
      '',
    );
  }
  if (p.helpers.has('cobolNum')) {
    helpers.push(
      'def _cobol_num(value: Decimal | int, digits: int, scale: int) -> str:',
      '    """COBOL DISPLAY of a numeric field: zero-padded digits with an implied decimal point."""',
      '    raw = str(int((abs(Decimal(value)) * (10 ** scale)).to_integral_value(rounding=ROUND_DOWN)))[-digits:]',
      '    return ("-" if value < 0 else "") + raw.rjust(digits, "0")',
      '',
      '',
    );
  }
  if (p.helpers.has('pad')) {
    helpers.push('def _pad(value: str, length: int) -> str:', '    """COBOL alphanumeric fields are fixed length: pad with spaces or truncate."""', '    return (value or "")[:length].ljust(length)', '', '');
  }
  if (p.helpers.has('endOfFile')) {
    helpers.push(
      'def _end_of_file(file: str) -> bool:',
      '    """COBOL READ ... AT END: wire READ to the modern file or database API and report end-of-file here."""',
      '    raise NotImplementedError(f"READ ... AT END is not translated yet for {file}")',
      '',
      '',
    );
  }
  if (p.helpers.has('stringBuffer')) {
    helpers.push(
      'class StringBuffer:',
      '    """Legacy StringBuffer shim with chainable append()."""',
      '',
      '    def __init__(self, initial: str = "") -> None:',
      '        self._parts: list[str] = [initial] if initial else []',
      '',
      '    def append(self, value: object) -> "StringBuffer":',
      '        self._parts.append(str(value))',
      '        return self',
      '',
      '    def __str__(self) -> str:',
      '        return "".join(self._parts)',
      '',
      '',
    );
  }
  if (p.helpers.has('enumeration')) {
    helpers.push(
      'class Enumeration:',
      '    """Legacy Enumeration shim over any iterable."""',
      '',
      '    _END = object()',
      '',
      '    def __init__(self, source) -> None:',
      '        self._it = iter(source)',
      '        self._next = next(self._it, self._END)',
      '',
      '    def has_more_elements(self) -> bool:',
      '        return self._next is not self._END',
      '',
      '    def next_element(self):',
      '        value, self._next = self._next, next(self._it, self._END)',
      '        return value',
      '',
      '',
    );
  }
  if (unit.usesStopRun) helpers.push('class StopRun(Exception):', '    """Raised by STOP RUN inside a nested paragraph and caught by run()."""', '', '');
  const imports = ['from __future__ import annotations', '', 'import sys'];
  if (p.imports.has('math')) imports.push('import math');
  if (unit.records.length) imports.push('from dataclasses import dataclass, field');
  if (p.imports.has('datetime')) imports.push('from datetime import datetime');
  if (p.imports.has('decimal') || p.helpers.has('scale') || p.helpers.has('cobolNum')) imports.push('from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal');
  imports.push('from typing import TextIO');
  for (const u of p.refs || []) imports.push(`from .${ctx.fileStems.get(u)} import ${u.className}`);
  const runnable = unit.runSequence.length || hasRun;
  const staticMain = unit.methods.find((m) => m.name === 'main' && m.isStatic);
  return [
    `"""${unit.className}: modernized from ${unit.mod.file} (${unit.mod.language.toUpperCase()} ${unit.mod.kind} ${unit.mod.name}).`,
    '',
    'Rule-based structural translation: control flow and data layout mirror the legacy code.',
    'Resolve any manual-translation TODO markers before merging.',
    '"""',
    ...imports,
    '',
    '',
    ...helpers,
    ...recLines,
    `class ${cls}:`,
    ...classBody,
    '',
    '',
    ...(unit.staticInits.length ? [`${cls}._static_init()`, '', ''] : []),
    'if __name__ == "__main__":',
    runnable ? `    ${cls}().run()` : staticMain ? `    ${cls}.main([])` : `    ${cls}()`,
    '',
  ].join('\n');
}

function pyTest(unit, ctx, moduleName) {
  const cls = unit.className;
  const runnable = unit.runSequence.length || unit.methods.some((m) => m.name === 'run');
  return `"""Characterization tests for ${cls} (legacy ${unit.mod.file})."""
import io

import pytest

from ${ctx.pyPackage}.${moduleName} import ${cls}

# Paste the legacy program's console output here to lock in its behaviour.
EXPECTED_OUTPUT: str | None = None


def capture_run() -> str:
    buffer = io.StringIO()
    ${runnable ? `${cls}(out=buffer).run()` : `${cls}(out=buffer)`}
    return buffer.getvalue()


def test_runs_to_completion() -> None:
    capture_run()


def test_matches_legacy_output() -> None:
    if EXPECTED_OUTPUT is None:
        pytest.skip("record the legacy output first")
    assert capture_run() == EXPECTED_OUTPUT
`;
}

function pyProjectFiles(units, ctx) {
  const fastapi = ctx.framework === 'fastapi';
  const runnable = units.filter((u) => u.runSequence.length || u.methods.some((m) => m.name === 'run'));
  const files = [
    {
      path: 'pyproject.toml',
      language: 'toml',
      kind: 'config',
      content: `[project]
name = "${ctx.slug}"
version = "1.0.0"
requires-python = ">=3.12"
dependencies = [${fastapi ? '"fastapi>=0.115", "uvicorn>=0.32"' : ''}]

[project.optional-dependencies]
test = ["pytest>=8"${fastapi ? ', "httpx>=0.27"' : ''}]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
`,
    },
    { path: `src/${ctx.pyPackage}/__init__.py`, language: 'python', kind: 'source', content: `"""Modernized ${ctx.projectName}."""\n` },
  ];
  if (fastapi) {
    files.push({
      path: `src/${ctx.pyPackage}/app.py`,
      language: 'python',
      kind: 'source',
      content: `"""HTTP facade exposing each modernized program; run with: uvicorn ${ctx.pyPackage}.app:app"""
import io

from fastapi import FastAPI, HTTPException

${runnable.map((u) => `from .${ctx.fileStems.get(u)} import ${u.className}`).join('\n')}

app = FastAPI(title="${ctx.projectName} (modernized)")

PROGRAMS = {
${runnable.map((u) => `    "${kebab(u.className)}": ${u.className},`).join('\n')}
}


@app.get("/api/programs")
def programs() -> list[str]:
    return list(PROGRAMS)


@app.post("/api/{program}/run")
def run_program(program: str) -> dict:
    cls = PROGRAMS.get(program)
    if cls is None:
        raise HTTPException(status_code=404, detail="Unknown program")
    buffer = io.StringIO()
    cls(out=buffer).run()
    return {"program": program, "lines": buffer.getvalue().splitlines()}
`,
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function translate(parsed, analysis, { language, framework, projectName }) {
  const modules = parsed.flatMap((p) => p.modules);
  const slug = slugify(projectName);
  const ctx = {
    target: language,
    framework,
    projectName,
    slug,
    javaPackage: `com.modernized.${slug}`,
    pyPackage: slug,
    csNamespace: `Modernized${projectName.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'App'}`.slice(0, 60),
    units: [],
    fileStems: new Map(),
  };
  // Units that only declare records/constants still become classes so data is preserved.
  const units = modules.map((m) => buildUnit(m, analysis, language));
  const taken = new Set();
  for (const u of units) {
    let n = u.className;
    let i = 2;
    while (taken.has(n)) {
      n = `${u.className}${i}`;
      i += 1;
    }
    taken.add(n);
    u.className = n;
  }
  ctx.units = units;
  for (const u of units) ctx.fileStems.set(u, language === 'typescript' ? kebab(u.className) : toSnake(u.className));
  const Printer = PRINTERS[language];
  const files = [];
  const mapping = [];
  const dataMapping = [];
  let todos = 0;
  for (const u of units) {
    const p = new Printer(u, ctx);
    const origPrint = p.printStmt.bind(p);
    // Static methods have no instance writer.
    p.printStmt = (text, newline) => {
      if (!p.staticContext) return origPrint(text, newline);
      if (language === 'java') return `System.out.${newline ? 'println' : 'print'}(${text})`;
      if (language === 'csharp') return `Console.${newline ? 'WriteLine' : 'Write'}(${text})`;
      if (language === 'typescript') return `process.stdout.write(${text}${newline ? " + '\\n'" : ''})`;
      return `print(${text}${newline ? '' : ', end=""'})`;
    };
    let path;
    let content;
    let testPath;
    let testContent;
    if (language === 'java') {
      const dir = ctx.javaPackage.replace(/\./g, '/');
      path = `src/main/java/${dir}/${u.className}.java`;
      content = javaFile(u, p, ctx);
      testPath = `src/test/java/${dir}/${u.className}Test.java`;
      testContent = javaTest(u, ctx);
    } else if (language === 'csharp') {
      path = `src/${ctx.csNamespace}/${u.className}.cs`;
      content = csharpFile(u, p, ctx);
      testPath = `tests/${ctx.csNamespace}.Tests/${u.className}Tests.cs`;
      testContent = csharpTest(u, ctx);
    } else if (language === 'typescript') {
      const stem = ctx.fileStems.get(u);
      path = `src/${stem}.ts`;
      content = tsFile(u, p, ctx);
      testPath = `test/${stem}.test.ts`;
      testContent = tsTest(u, stem);
    } else {
      const stem = ctx.fileStems.get(u);
      path = `src/${ctx.pyPackage}/${stem}.py`;
      content = pyFile(u, p, ctx);
      testPath = `tests/test_${stem}.py`;
      testContent = pyTest(u, ctx, stem);
    }
    todos += p.todos;
    files.push({ path, language, kind: 'source', content, legacyFile: u.mod.file, unit: u.className });
    files.push({ path: testPath, language, kind: 'test', content: testContent, legacyFile: u.mod.file, unit: u.className });
    for (const m of u.methods) {
      mapping.push({
        legacyProcedure: m.legacy.id,
        legacyName: m.legacy.name,
        legacyFile: u.mod.file,
        legacyLines: [m.legacy.loc.start, m.legacy.loc.end],
        modernSymbol: `${u.className}.${m.isConstructor ? u.className : m.name}`,
        modernFile: path,
        notes: m.metrics && !m.metrics.reachable ? 'Unreachable in the legacy program; kept for review' : '',
      });
    }
    const typeOf = (t) => p.typeName(t);
    for (const f of u.fields) dataMapping.push({ legacyName: f.legacyName, modernName: `${u.className}.${f.name}`, modernType: typeOf(f.type), notes: clip(f.comment || '', 120) });
    for (const r of u.records) for (const f of r.fields) dataMapping.push({ legacyName: f.legacyName, modernName: `${r.name}.${f.name}`, modernType: typeOf(f.type), notes: `field of ${r.legacyName}` });
  }
  const frameworkFiles =
    language === 'java' ? javaProjectFiles(units, ctx) : language === 'csharp' ? csharpProjectFiles(units, ctx) : language === 'typescript' ? tsProjectFiles(units, ctx) : pyProjectFiles(units, ctx);
  files.push(...frameworkFiles);
  const notes = [
    { category: 'decision', text: 'Each legacy module became one class; procedures and paragraphs became methods with their original order and call structure preserved.' },
    { category: 'decision', text: 'Program output goes through an injectable writer so characterization tests can capture it.' },
  ];
  if (modules.some((m) => m.language === 'cobol')) {
    notes.push({ category: 'decision', text: 'COBOL fixed-point fields use exact decimal types; COMPUTE/ADD results are truncated (or rounded for ROUNDED) to the receiving field\'s scale, as in the original.' });
    notes.push({ category: 'risk', text: 'High-order truncation on numeric overflow (e.g. PIC 9(3) receiving 1000) is not emulated; add range checks where values can exceed the legacy picture.' });
    notes.push({ category: 'decision', text: 'Numeric DISPLAY keeps the COBOL zero-padded format so console output matches the legacy run byte-for-byte; switch to formatted output once parity is confirmed.' });
  }
  if (modules.some((m) => m.language === 'vb6')) notes.push({ category: 'decision', text: 'VB6 1-based arrays keep their declared bounds by shifting indices; assignments to a function name became an explicit result variable.' });
  if (language === 'typescript' && modules.some((m) => m.language === 'cobol' || m.language === 'vb6')) notes.push({ category: 'risk', text: 'TypeScript numbers are binary floating point; fixed-point amounts are re-scaled after each operation but consider decimal.js for money.' });
  if (todos) notes.push({ category: 'todo', text: `${todos} construct(s) could not be translated mechanically and are marked TODO(manual).` });
  for (const f of analysis.findings.filter((x) => x.severity !== 'info').slice(0, 12)) notes.push({ category: 'risk', text: `${f.message} (${f.file}:${f.line})` });
  return {
    engine: 'structural',
    summary: `Rule-based structural translation of ${modules.length} legacy module(s) into ${files.filter((f) => f.kind === 'source').length} ${language} source file(s) with characterization-test scaffolding.`,
    files,
    mapping,
    dataMapping,
    notes,
    testPlan: units.map((u) => ({ name: `${u.className} characterization`, covers: u.methods.map((m) => m.legacy.id), description: 'Runs the translated program and compares its console output with a recorded legacy run.' })),
    todos,
  };
}
