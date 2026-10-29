# Verilog Style Guide

> Source: Google Verilog Style Guide (https://google.github.io/styleguide/verilogguide.html)

## Quick Rules

- Target SystemVerilog IEEE 1800-2017 for all digital design IP unless legacy constraints require earlier standards.
- Indent with 2 spaces, no tabs. Lines must not exceed 100 characters.
- One module per file. File name must match module name in `lower_snake_case` (e.g. `fifo_buffer.sv`).
- Explicit port declaration: specify direction, type, and signedness for all ports.
- Never use implicit nets (always add `` `default_nettype none `` at the top of files).
- Distinguish sequential and combinational logic cleanly:
  - Use `always_ff @(posedge clk or negedge rst_n)` with non-blocking assignments (`<=`) for sequential logic.
  - Use `always_comb` with blocking assignments (`=`) for combinational logic.
  - Use `always_latch` with non-blocking assignments (`<=`) for level-sensitive latches.
- Active-low resets should end with `_n` or `_b` (e.g. `rst_n`).
- Clocks should be named `clk` or prefixed/suffixed with `clk` (e.g. `clk_sys`).

## Formatting

- Indentation: 2 spaces per indentation level.
- Maximum line length: 100 characters.
- Keywords: lowercase (`module`, `endmodule`, `logic`, `input`, `output`, `always_comb`).
- Align port declarations and parameters cleanly for readability.
- Trailing commas are permitted in SystemVerilog parameter/port lists where supported; otherwise comma-at-end.
- One statement per line.

## Naming

- Modules and interfaces: `lower_snake_case` matching the filename (`uart_receiver`).
- Signals and variables: `lower_snake_case` (`data_valid`, `packet_count`).
- Parameters and `localparam`: `UPPER_SNAKE_CASE` (`DATA_WIDTH`, `FIFO_DEPTH`).
- Active-low signals: suffix `_n` (`rst_n`, `valid_n`).
- Clock signals: prefix or suffix `clk` (`clk_core`, `axi_clk`).
- Types and typedefs: suffix `_t` (`state_e_t`, `packet_header_t`).
- Enumeration values: suffix `_e` or prefix with enum name (`STATE_IDLE`, `STATE_BUSY`).

## Anti-Patterns

- Mixing blocking (`=`) and non-blocking (`<=`) assignments within the same procedural block.
- Using plain `always @*` instead of `always_comb` in SystemVerilog.
- Relying on default net types without `` `default_nettype none ``.
- Inferred latches caused by incomplete `if`/`case` branches in `always_comb`. Always specify default values.
- Hardcoded bit widths or magic numbers instead of `localparam` or package constants.

## Code Example

```systemverilog
`default_nettype none

module counter_up_down #(
  parameter int unsigned DATA_WIDTH = 8
) (
  input  wire                    clk,
  input  wire                    rst_n,
  input  wire                    enable,
  input  wire                    up_down_n, // 1: up, 0: down
  output logic [DATA_WIDTH-1:0]  count
);

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= '0;
    end else if (enable) begin
      if (up_down_n) begin
        count <= count + 1'b1;
      end else begin
        count <= count - 1'b1;
      end
    end
  end

endmodule

`default_nettype wire
```

## Sources
- https://google.github.io/styleguide/verilogguide.html
