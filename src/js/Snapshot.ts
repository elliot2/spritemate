/*
  VICE Snapshot Monitor and Sprite Grabber
*/
import { dom } from "./helper";
import Window_Controls from "./Window_Controls";
import { App } from './App';

const VIC_BASE = 0xD000;
const VIC_MULTICOLOR = 0xd01c; // enable bits 0-7
const VIC_SPRITE_ENABLE = 0xd015; // bits 0-7
const VIC_SPRITE_EXPAND_X = 0xd01d;
const VIC_SPRITE_EXPAND_Y = 0xd017;
const VIC_SPRITE_ADDR = 0xd018; // bits 4-7 for video matrix, and last 64 bytes for sprite addresses
const VIC_SPRITE_MCOLOR_0 = 0xd025; // shared colours
const VIC_SPRITE_MCOLOR_1 = 0xd026; // shared colours
const VIC_SPRITE_COL0 = 0xd027; // individual colours
const VIC_BG_COL0 = 0xd021; // sprite background


const CIA2_VIC_BANK = 0xDD00; // bits 0-2 inverted for bank

export default class Snapshot extends Window_Controls {
  help: string;
  lastCmd: string;
  lastIndex = -1;

  fullSnapshot: Uint8Array | null;
  c64mem: Uint8Array | null;
  viciimem: Uint8Array | null;
  cia2mem: Uint8Array | null;

  event: any;
  app: App | null;

  constructor(public window: number, public config, public eventhandler) {
    super();
    this.app = (window as any).app;
    this.event = eventhandler;
    this.config = config;
    this.window = window;
    this.c64mem = null;
    this.viciimem = null;
    this.cia2mem = null;
    this.fullSnapshot = null;
    this.lastCmd = "";
    this.help = `
commands :

mem n
        show memory at n
        eg. mem 0x400

edit n v
        eg. edit 0x400 0x01
        eg. edit 0x400 0x01 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09

vic
        show VIC-II memory

vid <bank>
        calc video matrix address
        video matrix nibble*1k + bank*16kB
        eg. vid 0

cia
        show CIA-II memory
        reports bank (last 3 bits inverted)

sprites
        show sprite memory

grab n
        grab a sprite
        eg. grab 0

grabcols
        grab sprite colors

`;
    const template = `
        <div class="window_menu">
        </div>
        <div class="ui-sortable">
            <textarea id="snapshot-console" class="console" spellcheck="false">] </textarea>
        </div>
    `;
    dom.append("#window-" + this.window, template);

    dom.sel("#snapshot-console").onkeyup = (e) => {
      if (e.key === "Enter") {
        const command = dom.val("#snapshot-console");
        const lines = command.split("\n");
        const last_line = lines[lines.length - 2];
        const last_line_trimmed_without_prompt = this.removePrompt(last_line);
        this.command(last_line_trimmed_without_prompt);
        this.prompt();
      }
    };
  }

  removePrompt(line: string): string {
    const prompt = "] ";
    if (line.startsWith(prompt)) {
      return line.slice(prompt.length);
    }
    return line;
  }

  load_snapshot(file: File, filename: string) {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = () => {
      const file = reader.result as ArrayBuffer;
      this.message("loading snapshot " + filename);

      let c64word = "C64MEM\0\0\0\0\0\0\0\0\0\0";
      const c64mem = new Uint8Array(file);
      let c64mem_index = -1;
      let letter_index = 0;
      for (let i = 0; i < c64mem.length; i++) {
        if (c64mem[i] == c64word[letter_index].charCodeAt(0)) {
          letter_index++;
          if (letter_index == c64word.length) {
            c64mem_index = i;
            break;
          }
        } else {
          letter_index = 0;
        }
      }

      if (c64mem_index == -1) {
        this.message("snapshot not found");
        return;
      }

      this.c64mem = new Uint8Array(c64mem.slice(c64mem_index + 11));

      c64word = "CIA2\0\0\0\0\0\0\0\0\0\0";
      letter_index = 0;
      for (let i = c64mem_index; i < c64mem.length; i++) {
        if (c64mem[i] == c64word[letter_index].charCodeAt(0)) {
          letter_index++;
          if (letter_index == c64word.length) {
            c64mem_index = i;
            break;
          }
        } else {
          letter_index = 0;
        }
      }
      this.cia2mem = new Uint8Array(c64mem.slice(c64mem_index + 9));

      c64word = "VIC-II\0\0\0\0\0\0\0\0\0\0";
      letter_index = 0;
      for (let i = c64mem_index; i < c64mem.length; i++) {
        if (c64mem[i] == c64word[letter_index].charCodeAt(0)) {
          letter_index++;
          if (letter_index == c64word.length) {
            c64mem_index = i;
            break;
          }
        } else {
          letter_index = 0;
        }
      }
      this.viciimem = new Uint8Array(c64mem.slice(c64mem_index + 8));
      this.message("snapshot loaded " + c64mem.length + " bytes");
    };
  }

  prompt(): void {
    dom.val("#snapshot-console", dom.val("#snapshot-console") + "] ");
    const textarea = dom.sel("#snapshot-console");
    textarea.scrollTop = textarea.scrollHeight;
  }

  /* Use this for adhoc message to display the prompt */
  message(message: string): void {
    this.println(message);
    this.prompt();
    const textarea = dom.sel("#snapshot-console");
    textarea.scrollTop = textarea.scrollHeight;
  }

  print(message: string): void {
   dom.val("#snapshot-console", dom.val("#snapshot-console") + message);
  }

  println(message: string | number = ""): void {
    dom.val("#snapshot-console", dom.val("#snapshot-console") + message + "\n");
  }

  formatMemory(address: number): string {
    const convertPetsciiToAscii = (byte) => {
      if (byte >= 1 && byte <= 26) {
        return String.fromCharCode(byte + 64);
      }
      if (byte >= 27 && byte <= 63) {
        return String.fromCharCode(byte);
      }
      return ".";
    };
    const hexAddress = address.toString(16).padStart(4, "0");
    if (this.c64mem == null) return "";
    const mem = this.c64mem;
    const bytes = Array.from({ length: 16 }, (_, i) => mem[address + i]);
    const hexBytes = bytes
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = bytes.map((byte) => convertPetsciiToAscii(byte)).join("");
    return `${hexAddress} |${hexBytes}  |${ascii}|`;
  }

  video_matrix_address(address: number, bank = 0): number {
    const range = address >> 4;
    const video_matrix_base = bank * 16384;
    const video_matrix_address = video_matrix_base + range * 1024;
    return video_matrix_address;
  }

  sprite_address(number: number): number {
    if (this.cia2mem == null || this.viciimem == null || this.c64mem == null) {
      return 0;
    }
    const sprite_base = 0x03f8;
    const bank = this.cia2_bank(this.cia2mem[0]);
    const vid = this.viciimem[VIC_SPRITE_ADDR - VIC_BASE];
    const vidAdd = this.video_matrix_address(vid, bank);
    const sprite_address = this.c64mem[sprite_base + vidAdd +number] * 64;
    return sprite_address;
  }

  cia2_bank(val: number): number {
    const bank = val & 0x03;
    return 3-bank;
  }

  command(command: string): void {
    this.connect();
    const command_parts = command.split(" ");
    const command_name = command_parts[0];
    const command_args = command_parts.slice(1);
    const command_args_string = command_args.join(" ");
    const command_args_number = parseInt(command_args_string);
    const command_args_number_hex = parseInt(command_args_string, 16);
    const args: number[] = [];
    for (let i = 1; i < command_parts.length; i++) {
      args.push(parseInt(command_parts[i], 16));
    }
    if (args.length == 0) {
      args.push(0);
    }
    if (command_name == "") {
      if (this.lastCmd === "mem") {
        this.command(this.lastCmd);
        return;
      }
      return;
    }
    switch (command_name) {
      case "grabcols": {
        if (this.viciimem == null) {
            this.message("no snapshot loaded");
            return;
          }
        const mcol0 = this.viciimem[(VIC_SPRITE_MCOLOR_0) - VIC_BASE];
        const mcol1 = this.viciimem[(VIC_SPRITE_MCOLOR_1) - VIC_BASE];
        const bg = this.viciimem[(VIC_BG_COL0) - VIC_BASE];
        const all = this.app?.sprite.get_all();
        all.colors[0] = bg;
        all.colors[2] = mcol0;
        all.colors[3] = mcol1;
        this.app?.list.update_all(this.app?.sprite.get_all());
        this.app?.update();
        break;
      }
      case "grab": {
        if (this.c64mem == null || this.viciimem == null) {
          this.message("no snapshot loaded");
          return;
        }
        let sprite = 0;

        if (command_args.length > 0) {
          sprite = parseInt(command_args[0]);
        }

        this.app?.sprite.new_sprite(1, true);
        this.app?.list.update_all(this.app?.sprite.get_all());
        this.app?.update();
        const all = this.app?.sprite.get_all();
        const data = all.sprites[all.current_sprite].pixels;
        all.sprites[all.current_sprite].multicolor = true;
        all.sprites[all.current_sprite].color = this.viciimem[(sprite + VIC_SPRITE_COL0) - VIC_BASE];

        let posx = 0;
        let posy = 0;
        
        const spriteAddr = this.sprite_address(sprite);
        const bitReversal = (x: number) =>  ((x & 1) << 1) | ((x & 2) >> 1);
      
        for (let i = 0; i <= 62; i++) {
          const col = this.c64mem[spriteAddr + i];
          let nib = (col >> 6) & 3;
          data[posy][posx] = bitReversal(nib);
          posx+=2;

          nib = (col >> 4) & 3;
          data[posy][posx] = bitReversal(nib);
          posx+=2;

          nib = (col >> 2) & 3;
          data[posy][posx] = bitReversal(nib);
          posx+=2;

          nib = col & 3;
          data[posy][posx] = bitReversal(nib);
          posx+=2;

          if (posx >= 22) {
            posx = 0;
            posy++;
          }
        }

        this.app?.update();
        this.println();
        break;
      }
      case "sprites": {
        if (this.cia2mem == null || this.viciimem == null) {
          this.message("no snapshot loaded");
          return;
        }

        this.println("Sprite enabled reg");
        const enabled = this.viciimem[(VIC_SPRITE_ENABLE) - VIC_BASE];
        this.println(enabled.toString(2).padStart(8, "0"));
        this.println();

        this.println("Sprite multicolour reg");
        const multicol = this.viciimem[(VIC_MULTICOLOR) - VIC_BASE];
        this.println(multicol.toString(2).padStart(8, "0"));
        this.println();

        this.println("Sprite expand regs");
        const expand_x = this.viciimem[(VIC_SPRITE_EXPAND_X) - VIC_BASE];
        const expand_y = this.viciimem[(VIC_SPRITE_EXPAND_Y) - VIC_BASE];
        this.println(expand_x.toString(2).padStart(8, "0"));
        this.println(expand_y.toString(2).padStart(8, "0"));
        this.println();


        this.println("Sprite memory");      
        for (let i = 0; i <= 7; i++) {
          const spriteAddr = this.sprite_address(i).toString(16).padStart(4, "0");
          this.print(spriteAddr + " |");
        }
        this.println();
        this.println();

        this.println("Sprite colours");
        for (let i = 0; i <= 7; i++) {
          const col = this.viciimem[(i + VIC_SPRITE_COL0) - VIC_BASE];
          this.print(col.toString(16).padStart(2, "0") + " |");
        }
        this.println();
        this.println();

        this.println("Sprite multi colour regs");
        const mcol0 = this.viciimem[(VIC_SPRITE_MCOLOR_0) - VIC_BASE];
        const mcol1 = this.viciimem[(VIC_SPRITE_MCOLOR_1) - VIC_BASE];
        this.println(mcol0.toString(16).padStart(2, "0"));
        this.println(mcol1.toString(16).padStart(2, "0"));
        this.println();

        this.println("Sprite background");
        const bg = this.viciimem[(VIC_BG_COL0) - VIC_BASE];
        this.println(bg.toString(16).padStart(2, "0"));
        this.println();
        
        break;
      }
      case "cia": {
        if (this.cia2mem == null) {
          this.message("no snapshot loaded");
          return;
        }
       this.print("CIA-II memory\n");
        for (let i = 0; i < 16; i++) {
          if (i % 16 == 0) {
            const hexAddress = (i + CIA2_VIC_BANK).toString(16).padStart(4, "0");
            this.print(hexAddress + " |");
          }
          this.print(this.cia2mem[i].toString(16).padStart(2, "0") + " ");
          if ((i + 1) % 16 == 0) {
            this.println();
          }
        }
        this.println("CIA bank");
        const bank = this.cia2_bank(this.cia2mem[0]);
        this.println(bank);

        break;
      }

      case "vid": {
        if (this.viciimem == null) {
          this.message("no snapshot loaded");
          return;
        }

        let bank = 0;
        if (command_args.length > 0) {
          bank = parseInt(command_args[0]);
        }
                
        this.println("Video matrix memory");
        const vid = this.viciimem[0xd018 - VIC_BASE];
        const vidAdd = this.video_matrix_address(vid, bank);
        this.println(vidAdd.toString(16).padStart(4, "0"));              
        break;
      }
      case "vic":
        if (this.viciimem == null) {
          this.message("no snapshot loaded");
          return;
        }
       this.println("VIC-II memory");
        for (let i = 0; i < 64; i++) {
          if (i % 16 == 0) {
            const hexAddress = (i + 0xd000).toString(16).padStart(4, "0");
            this.print(hexAddress + " |");
          }
          this.print(this.viciimem[i].toString(16).padStart(2, "0") + " ");
          if ((i + 1) % 16 == 0) {
            this.print("\n");
          }
        }
        this.println();

        break;

      case "edit":
        if (this.c64mem == null) {
          this.message("no snapshot loaded");
          return;
        }
        if (command_args.length < 2) {
          this.message("not enough arguments");
          return;
        }
        if (isNaN(args[0])) {
          this.message("bad address");
          return;
        }
        if (args[0] < 0 || args[0] > this.c64mem.length) {
          this.message("address out of range");
          return;
        }
        for (let i = 1; i < args.length; i++) {
          if (isNaN(args[i])) {
            this.message("bad value");
            return;
          }
          if (args[i] < 0 || args[i] > 255) {
            this.message("value out of range");
            return;
          }
          this.c64mem[args[0] + i - 1] = args[i];
        }
        this.message("memory edited");
        break;

      case "mem": {
        if (this.c64mem == null) {
          this.message("no snapshot loaded");
          return;
        }
        if (command_args.length == 0) {
          if (this.lastIndex == -1) {
            this.message("no address specified");
            return;
          }
          this.lastIndex = this.lastIndex + 16;
          this.print(this.formatMemory(this.lastIndex) +
            "\n"
          );
          return;
        }
        let address = command_args_number;
        if (isNaN(address)) {
          address = command_args_number_hex;
        }
        if (isNaN(address)) {
          this.print("bad address\n");
          break;
        }
        if (address < 0 || address > this.c64mem.length) {
          this.println("address out of range");
          break;
        }
        this.println(this.formatMemory(address));
        this.lastIndex = address + 16;
        break;
      }
      case "help":
        this.print(this.help);
        break;

      default:
        if (command_name.length > 0) {
         this.println("bad command " +
              command_name);
        }
        this.println("type help");
        break;
    }

    this.lastCmd = command_name;
  }

  update(all_data): void {
    this.connect();
  }

  connect(): void {
    this.app = (window as any).app;
  }
}