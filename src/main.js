import { RubyVM } from "@ruby/wasm-wasi";
import { File, WASI, OpenFile, ConsoleStdout } from "@bjorn3/browser_wasi_shim";

class RubyRunner {
  constructor() {
    this.rubyVM = null;
    this.initialized = false;
    this.testCode = null;
  }

  // Ruby.wasmの初期化
  async initialize() {
    if (this.initialized) return;

    try {
      this.rubyVM = await this.createVM();

      // minitestが利用可能か確認
      this.rubyVM.eval(`
        begin
          require 'minitest'
          true
        rescue LoadError
          false
        end
      `);

      // テストコードの読み込み
      await this.loadTestCode();

      this.initialized = true;
      console.log("Ruby.wasm initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Ruby.wasm:", error);
      throw error;
    }
  }
  async createVM() {
    let output = [];
    output.flush = function () {
      return this.splice(0, this.length).join("\n");
    };


    const setStdout = function (val) {
      console.log(val);
      output.push(val);
    };

    const setStderr = function (val) {
      console.warn(val);
      output.push(`[warn] ${val}`);
    };

    // ここでVMを手動でセットアップする
    const fds = [
      new OpenFile(new File([])), // stdin
      ConsoleStdout.lineBuffered(setStdout), // stdout
      ConsoleStdout.lineBuffered(setStderr), // stderr
    ];
    const wasi = new WASI([], [], fds, { debug: false });
    const vm = new RubyVM();
    const imports = {
      wasi_snapshot_preview1: wasi.wasiImport,
    };
    vm.addToImports(imports);
    const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.7.1/dist/ruby+stdlib.wasm");
    const module = await WebAssembly.compileStreaming(response);
    const instance = await WebAssembly.instantiate(module, imports);
    await vm.setInstance(instance);

    wasi.initialize(instance);
    vm.initialize();

    // 最後に、出力への参照を手作りVMオブジェクトに保存する
    vm.$output = output;
    return vm;
  }
  // テストコードの読み込み
  async loadTestCode() {
    try {
      const response = await fetch('calculator_test.rb');
      if (!response.ok) {
        throw new Error(`Failed to load test code: ${response.status} ${response.statusText}`);
      }
      this.testCode = await response.text();
      console.log("Test code loaded successfully");
    } catch (error) {
      console.error("Failed to load test code:", error);
      throw error;
    }
  }

  // ユーザーコードとテストコードを実行
  async runTest(userCode) {
    if (!this.initialized || !this.testCode) {
      await this.initialize();
    }

    try {
      // ユーザーコードを評価
      this.rubyVM.eval(userCode);

      // テストコードを評価（まだ実行はしない）
      this.rubyVM.eval(this.testCode);

      // 明示的にテストを実行
      this.rubyVM.eval("run_tests");

      return {
        output: this.rubyVM.$output,
        success: !this.rubyVM.$output.join("\n").includes("Failure:") && !this.rubyVM.$output.join("\n").includes("Error:")
      };
    } catch (error) {
      console.error("Error running test:", error);
      return {
        output: [error.message || "Unknown error occurred"],
        success: false
      };
    }
  }
}

// DOMが読み込まれたら実行
document.addEventListener('DOMContentLoaded', () => {
  const codeEditor = document.getElementById('code-editor');
  const runButton = document.getElementById('run-button');
  const testResult = document.getElementById('test-result');
  const loading = document.getElementById('loading');

  const rubyRunner = new RubyRunner();

  // 初期化を開始
  rubyRunner.initialize().catch(error => {
    testResult.textContent = `初期化エラー: ${error.message}`;
    testResult.classList.add('failure');
  });

  // 実行ボタンのクリックイベント
  runButton.addEventListener('click', async () => {
    // UIの更新
    runButton.disabled = true;
    loading.classList.remove('hidden');
    testResult.textContent = '';
    testResult.className = '';

    try {
      const userCode = codeEditor.value;
      // テストの実行
      const result = await rubyRunner.runTest(userCode);
      console.log(result);
      // 結果の表示
      testResult.textContent = result.output.join("\n");

      if (result.success) {
        testResult.classList.add('success');
      } else {
        testResult.classList.add('failure');
      }
    } catch (error) {
      testResult.textContent = `実行エラー: ${error.message}`;
      testResult.classList.add('failure');
    } finally {
      // UIの復元
      runButton.disabled = false;
      loading.classList.add('hidden');
    }
  });
});
