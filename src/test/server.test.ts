// https://github.com/rcjsuen/dockerfile-language-server-nodejs/blob/master/test/server.test.ts

import * as chai from "chai";
import * as child_process from "child_process";
import { CompletionItem, CompletionList, DocumentUri, Hover, MarkupContent, MarkupKind, Position, TextDocumentItem } from 'vscode-languageserver-types';
import {
  ClientCapabilities, InitializeParams, NotificationMessage, RequestMessage, ResponseMessage,
  DidOpenTextDocumentParams, CompletionParams, HoverParams, TextDocumentPositionParams,
  TextDocumentSyncKind, InitializeResult
} from 'vscode-languageserver-protocol';

const assert = chai.assert;


// fork the server and connect to it using Node IPC
const lspProcess = child_process.fork("node_modules/triton-lsp/out/src/server.js", ["--node-ipc"]);
let messageId = 42;


function sendRequest(ps: child_process.ChildProcess, method: string, params: any): number {
  const message: RequestMessage = {
    jsonrpc: "2.0",
    id: messageId++,
    method: method,
    params: params
  };
  ps.send(message);
  return messageId - 1;
}


function sendNotification(ps: child_process.ChildProcess, method: string, params: any) {
  const message: NotificationMessage = {
    jsonrpc: "2.0",
    method: method,
    params: params
  };
  ps.send(message);
}


const clientCapabilities: ClientCapabilities = {
  textDocument: {
    completion: {
      completionItem: {
        documentationFormat: [MarkupKind.Markdown],
        snippetSupport: true,
        // labelDetailSupport: true,    // [TODO] Enable since 3.17
      }
    },
    hover: {
      contentFormat: [MarkupKind.Markdown]
    }
  }
};


function initialize(): number {
  const rootUri: DocumentUri = process.cwd();
  const params: InitializeParams = {
    processId: process.pid,
    rootUri,
    workspaceFolders: [
      {
        uri: rootUri,
        name: "something"
      }
    ],
    capabilities: clientCapabilities,
  };

  return sendRequest(lspProcess, "initialize", params);
}


function prepare(text: string, position: Position, uri: string = "file://some/text/document.sh"): [
  DidOpenTextDocumentParams, TextDocumentPositionParams] {

  const textDocument = {
    uri,
    languageId: "shellscript",
    version: 2,
    text
  };
  const textDocumentIdentifier = { uri };
  const didOpenTextDocumentParams = { textDocument };
  const textDocumentPositionParams = { position, textDocument: textDocumentIdentifier };

  return [didOpenTextDocumentParams, textDocumentPositionParams];
}



describe("LSP Tests", () => {

  it("initialize", (done) => {
    const responseId = initialize();
    lspProcess.once('message', (json: ResponseMessage) => {

      console.log(`[LSP Tests] Object.keys(json) = ${Object.keys(json)}`);
      if ('error' in json) {
        assert.fail(`Got ResponseError: ${json.error?.message}`);
      }
      assert.strictEqual(json.id, responseId);
      const result = json.result as InitializeResult;
      const capabilities = result.capabilities;

      assert.deepStrictEqual(capabilities.textDocumentSync, TextDocumentSyncKind.Incremental);
      assert.strictEqual(capabilities.completionProvider?.resolveProvider, true);
      assert.strictEqual(capabilities.hoverProvider, true);
      assert.strictEqual(capabilities.codeActionProvider, undefined);
      assert.strictEqual(capabilities.foldingRangeProvider, undefined);
      assert.strictEqual(capabilities.renameProvider, undefined);

      done();

    });
  }).timeout(5000);


  it("initialized", (done) => {
    sendNotification(lspProcess, "initialized", {});
    done();
  });


  it("completion 1", (done) => {
    const text = "curl --ins  ";
    const position = Position.create(0, 10);
    const [ didOpenTextDocumentParams, completionParams1 ] = prepare(text, position);
    sendNotification(lspProcess, "textDocument/didOpen", didOpenTextDocumentParams);
    const id = sendRequest(lspProcess, "textDocument/completion", completionParams1);
    lspProcess.once("message", (json: ResponseMessage) => {

      if ('error' in json) {
        assert.fail(`Got ResponseError: ${json.error?.message}`);
      }

      // [TODO] check all possible IDs returned
      if (json.id === id) {
        const result = json.result as CompletionItem[];
        if (!Array.isArray(result)) {
          assert.fail("[completion 1] Result is not an array.");
        } else if (result.length === 0) {
          assert.fail("[completion 1] completion item list is empty.");
        }

        const labels = result.map(item => item.label);
        console.log(`[Autocomplete] labels = ${labels}`);
        done();
      } else {
        assert.fail(`[completion 1] What is this id? ${json.id}`);
      }

    });
  }).timeout(5000);


  it("hover 1", (done) => {
    const text = "curl --insecure ";
    const position = Position.create(0, 10);
    const [ didOpenTextDocumentParams, hoverParamsCom1 ] = prepare(text, position);
    const expected = "\`-k\`, \`--insecure\` \n\n Allow insecure server connections when using SSL";

    sendNotification(lspProcess, "textDocument/didOpen", didOpenTextDocumentParams);
    const id = sendRequest(lspProcess, "textDocument/hover", hoverParamsCom1);
    lspProcess.once("message", (json: ResponseMessage) => {

      if ('error' in json) {
        assert.fail(`Got ResponseError: ${json.error?.message}`);
      }

      // [TODO] check all possible IDs returned
      if (json.id === id) {
        if (Hover.is(json.result)) {
          if (MarkupContent.is(json.result.contents)) {
            assert.strictEqual(json.result.contents.kind, MarkupKind.Markdown);
            assert.strictEqual(json.result.contents.value, expected);
            done();
          } else {
            assert.fail("[hover 1] Expect hover to be MarkupContent.");
          }
        } else {
          assert.fail("[hover 1] result is not Hover.");
        }
      } else {
        assert.fail(`[hover 1] What is this id? ${json.id}`);
      }

    });
  }).timeout(5000);


  // Terminate LSP
  after(() => {
    lspProcess.kill();
  });

});