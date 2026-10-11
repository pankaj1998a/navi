use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryAnalysisResult {
    pub file: String,
    pub format: String,
    pub architecture: String,
    pub bits: usize,
    pub endian: String,
    pub kind: String,
    pub entry_point: Option<String>,
    pub sections_count: Option<usize>,
    pub notes: Vec<String>,
}

fn read_u16_le(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

fn read_u32_le(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

fn read_u64_le(buf: &[u8], off: usize) -> u64 {
    u64::from_le_bytes([
        buf[off], buf[off + 1], buf[off + 2], buf[off + 3],
        buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7],
    ])
}

fn read_u16_be(buf: &[u8], off: usize) -> u16 {
    u16::from_be_bytes([buf[off], buf[off + 1]])
}

fn read_u32_be(buf: &[u8], off: usize) -> u32 {
    u32::from_be_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

fn read_u64_be(buf: &[u8], off: usize) -> u64 {
    u64::from_be_bytes([
        buf[off], buf[off + 1], buf[off + 2], buf[off + 3],
        buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7],
    ])
}

fn parse_elf(buf: &[u8], path_str: &str) -> Option<BinaryAnalysisResult> {
    if buf.len() < 52 || &buf[0..4] != b"\x7fELF" {
        return None;
    }

    let is_64 = buf[4] == 2;
    let bits = if is_64 { 64 } else { 32 };
    let is_le = buf[5] == 1;
    let endian = if is_le { "little" } else { "big" };

    let osabi = match buf[7] {
        0 => "sysv",
        3 => "linux",
        6 => "solaris",
        9 => "freebsd",
        12 => "openbsd",
        _ => "unknown-abi",
    };

    let (elf_type, machine, entry_point, sections_count) = if is_le {
        let e_type = read_u16_le(buf, 16);
        let e_machine = read_u16_le(buf, 18);
        let entry = if is_64 && buf.len() >= 32 {
            read_u64_le(buf, 24)
        } else {
            read_u32_le(buf, 24) as u64
        };
        let shnum = if is_64 && buf.len() >= 62 {
            read_u16_le(buf, 60) as usize
        } else if buf.len() >= 50 {
            read_u16_le(buf, 48) as usize
        } else {
            0
        };
        (e_type, e_machine, entry, shnum)
    } else {
        let e_type = read_u16_be(buf, 16);
        let e_machine = read_u16_be(buf, 18);
        let entry = if is_64 && buf.len() >= 32 {
            read_u64_be(buf, 24)
        } else {
            read_u32_be(buf, 24) as u64
        };
        let shnum = if is_64 && buf.len() >= 62 {
            read_u16_be(buf, 60) as usize
        } else if buf.len() >= 50 {
            read_u16_be(buf, 48) as usize
        } else {
            0
        };
        (e_type, e_machine, entry, shnum)
    };

    let kind = match elf_type {
        1 => "relocatable",
        2 => "executable",
        3 => "shared-library",
        4 => "core",
        _ => "elf-unknown",
    };

    let arch = match machine {
        3 => "x86",
        62 => "x86_64",
        40 => "arm",
        183 => "aarch64",
        243 => "riscv",
        8 => "mips",
        20 => "ppc",
        21 => "ppc64",
        _ => "unknown-arch",
    };

    let mut notes = Vec::new();
    notes.push(format!("ELF OSABI: {}", osabi));
    if buf.len() >= 16 {
        notes.push(format!("e_flags: 0x{:x}", read_u32_le(buf, if is_64 { 48 } else { 36 })));
    }

    Some(BinaryAnalysisResult {
        file: path_str.to_string(),
        format: "elf".to_string(),
        architecture: arch.to_string(),
        bits,
        endian: endian.to_string(),
        kind: kind.to_string(),
        entry_point: Some(format!("0x{:x}", entry_point)),
        sections_count: Some(sections_count),
        notes,
    })
}

fn parse_pe(buf: &[u8], path_str: &str) -> Option<BinaryAnalysisResult> {
    if buf.len() < 64 || &buf[0..2] != b"MZ" {
        return None;
    }

    let pe_offset = read_u32_le(buf, 0x3c) as usize;
    if pe_offset + 24 > buf.len() || &buf[pe_offset..pe_offset + 4] != b"PE\0\0" {
        return None;
    }

    let coff = pe_offset + 4;
    let machine_id = read_u16_le(buf, coff);
    let num_sections = read_u16_le(buf, coff + 2) as usize;
    let characteristics = read_u16_le(buf, coff + 18);

    let opt_header = coff + 20;
    let (bits, entry_rva, subsystem) = if opt_header + 24 <= buf.len() {
        let magic = read_u16_le(buf, opt_header);
        let is_pe32_plus = magic == 0x20b;
        let bits = if is_pe32_plus { 64 } else { 32 };
        let entry = read_u32_le(buf, opt_header + 16);
        let sub = if opt_header + 68 <= buf.len() {
            read_u16_le(buf, opt_header + 68)
        } else {
            0
        };
        (bits, entry, sub)
    } else {
        (32, 0, 0)
    };

    let arch = match machine_id {
        0x014c => "x86",
        0x8664 => "x86_64",
        0x01c0 => "arm",
        0xaa64 => "aarch64",
        _ => "unknown-pe-arch",
    };

    let is_dll = (characteristics & 0x2000) != 0;
    let kind = if is_dll { "dll" } else { "exe" };

    let sub_str = match subsystem {
        1 => "native",
        2 => "windows-gui",
        3 => "windows-cui",
        _ => "other-subsystem",
    };

    let notes = vec![
        format!("Subsystem: {}", sub_str),
        format!("Characteristics: 0x{:04x}", characteristics),
    ];

    Some(BinaryAnalysisResult {
        file: path_str.to_string(),
        format: "pe".to_string(),
        architecture: arch.to_string(),
        bits,
        endian: "little".to_string(),
        kind: kind.to_string(),
        entry_point: Some(format!("0x{:x}", entry_rva)),
        sections_count: Some(num_sections),
        notes,
    })
}

fn parse_macho(buf: &[u8], path_str: &str) -> Option<BinaryAnalysisResult> {
    if buf.len() < 28 {
        return None;
    }

    let magic = read_u32_be(buf, 0);
    let (bits, is_le, is_fat) = match magic {
        0xfeedface => (32, false, false),
        0xcefaedfe => (32, true, false),
        0xfeedfacf => (64, false, false),
        0xcffaedfe => (64, true, false),
        0xcafebabe | 0xbebafeca => (32, false, true),
        _ => return None,
    };

    if is_fat {
        let nfat_arch = read_u32_be(buf, 4) as usize;
        return Some(BinaryAnalysisResult {
            file: path_str.to_string(),
            format: "macho-fat".to_string(),
            architecture: "universal".to_string(),
            bits: 64,
            endian: "big".to_string(),
            kind: "fat-binary".to_string(),
            entry_point: None,
            sections_count: None,
            notes: vec![format!("Contains {} fat architecture slices", nfat_arch)],
        });
    }

    let (cputype, filetype, ncmds) = if is_le {
        (read_u32_le(buf, 4), read_u32_le(buf, 12), read_u32_le(buf, 16))
    } else {
        (read_u32_be(buf, 4), read_u32_be(buf, 12), read_u32_be(buf, 16))
    };

    let arch = match cputype {
        7 => "x86",
        0x01000007 => "x86_64",
        12 => "arm",
        0x0100000c => "aarch64",
        _ => "unknown-macho-arch",
    };

    let kind = match filetype {
        1 => "object",
        2 => "executable",
        6 => "dylib",
        8 => "bundle",
        _ => "macho-other",
    };

    Some(BinaryAnalysisResult {
        file: path_str.to_string(),
        format: "macho".to_string(),
        architecture: arch.to_string(),
        bits,
        endian: if is_le { "little".into() } else { "big".into() },
        kind: kind.to_string(),
        entry_point: None,
        sections_count: Some(ncmds as usize),
        notes: vec![format!("Load commands count: {}", ncmds)],
    })
}

fn parse_wasm(buf: &[u8], path_str: &str) -> Option<BinaryAnalysisResult> {
    if buf.len() >= 8 && &buf[0..4] == b"\0asm" {
        let version = read_u32_le(buf, 4);
        return Some(BinaryAnalysisResult {
            file: path_str.to_string(),
            format: "wasm".to_string(),
            architecture: "wasm32".to_string(),
            bits: 32,
            endian: "little".to_string(),
            kind: "webassembly-module".to_string(),
            entry_point: None,
            sections_count: None,
            notes: vec![format!("Wasm binary version: {}", version)],
        });
    }
    None
}

fn parse_zip_or_apk(buf: &[u8], path_str: &str) -> Option<BinaryAnalysisResult> {
    if buf.len() >= 4 && &buf[0..4] == b"PK\x03\x04" {
        let is_apk = path_str.ends_with(".apk");
        return Some(BinaryAnalysisResult {
            file: path_str.to_string(),
            format: if is_apk { "apk" } else { "zip" }.to_string(),
            architecture: "arch-independent".to_string(),
            bits: 32,
            endian: "little".to_string(),
            kind: "compressed-archive".to_string(),
            entry_point: None,
            sections_count: None,
            notes: vec!["Valid PK zip archive magic detected".to_string()],
        });
    }
    None
}

fn parse_asar(buf: &[u8], path_str: &str) -> Option<BinaryAnalysisResult> {
    if buf.len() >= 16 && &buf[0..4] == b"\x04\x00\x00\x00" {
        let json_size = read_u32_le(buf, 12) as usize;
        return Some(BinaryAnalysisResult {
            file: path_str.to_string(),
            format: "asar".to_string(),
            architecture: "electron-asar".to_string(),
            bits: 64,
            endian: "little".to_string(),
            kind: "electron-archive".to_string(),
            entry_point: None,
            sections_count: None,
            notes: vec![format!("ASAR JSON header size: {} bytes", json_size)],
        });
    }
    None
}

pub fn inspect_binary(path: &Path) -> Result<BinaryAnalysisResult, String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let path_str = path.to_string_lossy().to_string();

    let mut buf = vec![0u8; 8192];
    let n = file.read(&mut buf).map_err(|e| format!("Failed to read header: {}", e))?;
    buf.truncate(n);

    if let Some(res) = parse_elf(&buf, &path_str) {
        return Ok(res);
    }
    if let Some(res) = parse_pe(&buf, &path_str) {
        return Ok(res);
    }
    if let Some(res) = parse_macho(&buf, &path_str) {
        return Ok(res);
    }
    if let Some(res) = parse_wasm(&buf, &path_str) {
        return Ok(res);
    }
    if let Some(res) = parse_zip_or_apk(&buf, &path_str) {
        return Ok(res);
    }
    if let Some(res) = parse_asar(&buf, &path_str) {
        return Ok(res);
    }

    Ok(BinaryAnalysisResult {
        file: path_str,
        format: "unknown".to_string(),
        architecture: "unknown".to_string(),
        bits: 0,
        endian: "unknown".to_string(),
        kind: "raw-data".to_string(),
        entry_point: None,
        sections_count: None,
        notes: vec!["Unrecognized magic signature".to_string()],
    })
}
