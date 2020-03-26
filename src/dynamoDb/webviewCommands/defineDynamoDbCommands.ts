import { DynamoDbFileChange } from '../../types'

export function defineDynamoDbCommands(folderList: DynamoDbFileChange[]) {
  return folderList.map((file) => {
    return {
      id: Math.random(),
      action: file.name.startsWith('update-')
        ? 'update'
        : file.name.startsWith('delete-')
        ? 'delete'
        : file.name.startsWith('create-')
        ? 'create'
        : null,
      compositKey: file.compositKey,
      timestamp: file.modified,
    }
  })
}