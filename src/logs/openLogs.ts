import * as vscode from 'vscode'
import { join } from 'path'
import { getWebviewHtml } from './functionLogsWebview'
import {
  getFontSize,
  getAutoRefreshInterval,
  getFontFamily,
  getAllSettings,
  updateSettings,
} from '../settings'
import { getAwsCredentials } from '../getAwsCredentials'
import { CloudWatchLogs, Lambda } from 'aws-sdk'
import { TreeItem } from '../TreeItem'
import { showLogsOptions } from './webviewCommands/showLogsOptions'

type LogsCommandData = {
  region: string
  awsProfile: string
  timeOffsetInMs: number
  tabs: {
    title: string
    logs: string
    lambda: string
    awsProfile: string
    region: string
  }[]
}

export const openLogs = (context: vscode.ExtensionContext) => async (
  treeItem: TreeItem,
  commandData: LogsCommandData
) => {
  const staticJs = 'resources/webview/build/static/js'
  const staticCss = 'resources/webview/build/static/css'
  const extesionPath = context.extensionPath

  const localResourceRoot = vscode.Uri.file(
    join(extesionPath, 'resources/webview')
  )

  if (!treeItem.panel) {
    treeItem.panel = vscode.window.createWebviewPanel(
      'slsConsoleLogs',
      `${treeItem.label}`,
      vscode.ViewColumn.One,
      {
        enableFindWidget: false,
        retainContextWhenHidden: true,
        enableScripts: true,
        localResourceRoots: [localResourceRoot],
      }
    )

    const viewState = context.workspaceState.get(`viewstate:${treeItem.id}`)
    const settings = getAllSettings()

    treeItem.panel.webview.html = await getWebviewHtml({
      panel: treeItem.panel,
      fontSize: getFontSize(),
      jsFiles: [
        vscode.Uri.file(join(extesionPath, staticJs, 'main1.js')),
        vscode.Uri.file(join(extesionPath, staticJs, 'main2.js')),
        vscode.Uri.file(join(extesionPath, staticJs, 'main3.js')),
      ],
      cssFiles: [
        vscode.Uri.file(join(extesionPath, staticCss, 'main1.css')),
        vscode.Uri.file(join(extesionPath, staticCss, 'main2.css')),
      ],
      inlineJs: `
        document.vscodeData = {
          page: 'logs',
          autoRefreshInterval: ${getAutoRefreshInterval()},
          fontSize: "${getFontSize()}",
          fontFamily: "${getFontFamily()}",
          tabs: ${JSON.stringify(commandData.tabs)},
          viewState: ${viewState ? JSON.stringify(viewState) : null},
          settings: ${settings ? JSON.stringify(settings) : null}
        }
      `,
    })

    if (treeItem.iconPathObj) {
      treeItem.panel.iconPath = {
        light: vscode.Uri.file(treeItem.iconPathObj.light),
        dark: vscode.Uri.file(treeItem.iconPathObj.dark),
      }
    }

    treeItem.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'viewstateChanged': {
            context.workspaceState.update(
              `viewstate:${treeItem.id}`,
              message.payload
            )
            break
          }
          case 'settingsChanged': {
            updateSettings(message.payload)
            break
          }
          case 'showLogsOptions': {
            const payload = await showLogsOptions()
            treeItem.panel?.webview?.postMessage({
              messageId: message.messageId,
              payload,
            })
            break
          }
          case 'getLogStreams': {
            if (!treeItem.panel.visible) {
              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  ignore: true,
                },
              })
              return null
            }

            try {
              const credentials = await getAwsCredentials(
                message.payload.awsProfile || commandData.awsProfile
              )
              const cloudwatchlogs = new CloudWatchLogs({
                credentials,
                region: message.payload.region || commandData.region,
              })

              const logStreams = await cloudwatchlogs
                .describeLogStreams({
                  limit: message.payload.limit,
                  orderBy: 'LastEventTime',
                  nextToken: message.payload.nextToken,
                  descending: true,
                  logGroupName: message.payload.logGroupName,
                })
                .promise()

              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  nextToken: logStreams.nextToken,
                  logStreams: logStreams.logStreams.map((logStream) => {
                    const timestamp =
                      logStream.lastEventTimestamp || logStream.creationTime

                    return {
                      ...logStream,
                      sortByTimestamp: commandData.timeOffsetInMs
                        ? timestamp + commandData.timeOffsetInMs
                        : timestamp,
                    }
                  }),
                },
              })
            } catch (err) {
              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  error:
                    err && err.message
                      ? err.message
                      : 'error retriving log streams',
                },
              })
            }
            break
          }
          case 'getLogEvents':
            {
              if (!treeItem.panel.visible) {
                treeItem.panel?.webview?.postMessage({
                  messageId: message.messageId,
                  payload: {
                    ignore: true,
                  },
                })
                return null
              }

              try {
                const credentials = await getAwsCredentials(
                  message.payload.awsProfile || commandData.awsProfile
                )
                const cloudwatchlogs = new CloudWatchLogs({
                  credentials,
                  region: message.payload.region || commandData.region,
                })

                const log = await cloudwatchlogs
                  .getLogEvents({
                    startFromHead: true,
                    nextToken: message.payload.nextToken,
                    logGroupName: message.payload.logGroup,
                    logStreamName: message.payload.logStream,
                  })
                  .promise()

                treeItem.panel?.webview?.postMessage({
                  messageId: message.messageId,
                  payload: {
                    functionName: treeItem.label,
                    logEvents: log.events.map((log) => {
                      return {
                        ...log,
                        timestamp: commandData.timeOffsetInMs
                          ? log.timestamp + commandData.timeOffsetInMs
                          : log.timestamp,
                      }
                    }),
                    nextBackwardToken: log.nextBackwardToken,
                    nextForwardToken: log.nextForwardToken,
                  },
                })
              } catch (err) {
                treeItem.panel?.webview?.postMessage({
                  messageId: message.messageId,
                  payload: {
                    error:
                      err && err.message
                        ? err.message
                        : 'error retriving log events',
                  },
                })
              }
            }
            break
          case 'getLambdaOverview': {
            try {
              const credentials = await getAwsCredentials(
                message.payload.awsProfile || commandData.awsProfile
              )
              const lambda = new Lambda({
                credentials,
                region: message.payload.region || commandData.region,
              })

              const lambdaOverview = await lambda
                .getFunction({
                  FunctionName: message.payload.fnName,
                })
                .promise()

              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  codeSize: lambdaOverview.Configuration.CodeSize,
                  lastModified: lambdaOverview.Configuration.LastModified,
                  memorySize: lambdaOverview.Configuration.MemorySize,
                  runtime: lambdaOverview.Configuration.Runtime,
                  timeout: lambdaOverview.Configuration.Timeout,
                },
              })
            } catch (err) {
              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  error:
                    err && err.message
                      ? err.message
                      : 'error retriving function overview',
                },
              })
            }
            break
          }
          case 'startQuery': {
            try {
              const credentials = await getAwsCredentials(
                message.payload.awsProfile || commandData.awsProfile
              )
              const cloudwatchlogs = new CloudWatchLogs({
                credentials,
                region: message.payload.region || commandData.region,
              })

              const { queryId } = await cloudwatchlogs
                .startQuery({
                  startTime: message.payload.startTime,
                  endTime: message.payload.endTime,
                  queryString: message.payload.query,
                  logGroupName: message.payload.logGroupName,
                })
                .promise()

              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                stream: true,
                payload: {
                  ref: message.payload.ref,
                  queryId,
                },
              })
            } catch (err) {
              console.log(err)
              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  error:
                    err && err.message ? err.message : 'error querying logs',
                },
              })
            }
            break
          }
          case 'getQueryResults': {
            try {
              const credentials = await getAwsCredentials(
                message.payload.awsProfile || commandData.awsProfile
              )
              const cloudwatchlogs = new CloudWatchLogs({
                credentials,
                region: message.payload.region || commandData.region,
              })

              const res = await cloudwatchlogs
                .getQueryResults({
                  queryId: message.payload.queryId,
                })
                .promise()

              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  ...res,
                  ref: message.payload.ref,
                },
              })
            } catch (err) {
              console.log(err)
              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {
                  error:
                    err && err.message ? err.message : 'error querying logs',
                },
              })
            }
            break
          }
          case 'stopQuery': {
            try {
              const credentials = await getAwsCredentials(
                message.payload.awsProfile || commandData.awsProfile
              )
              const cloudwatchlogs = new CloudWatchLogs({
                credentials,
                region: message.payload.region || commandData.region,
              })

              await cloudwatchlogs
                .stopQuery({
                  queryId: message.payload.queryId,
                })
                .promise()

              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {},
              })
            } catch (err) {
              treeItem.panel?.webview?.postMessage({
                messageId: message.messageId,
                payload: {},
              })
            }
            break
          }
        }
      },
      undefined,
      context.subscriptions
    )

    treeItem.panel.onDidDispose(() => {
      delete treeItem.panel
    })
  }
  treeItem.panel.reveal()
}
