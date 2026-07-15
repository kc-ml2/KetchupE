export const guideCopy = {
  createTeam: {
    description: [
      "팀은 멤버와 함께 문서를 공유하는 공간입니다.",
      "팀을 만든 뒤 멤버를 초대하고, 케찹이가 답변할 때 참고할 문서를 추가할 수 있습니다.",
    ],
  },
  teamDetail: {
    description:
      "이 팀에 추가된 문서는 팀 멤버 모두가 함께 사용할 수 있습니다. 케찹이는 이 문서들을 참고해 질문에 답변하고, 참고한 문서도 함께 보여줍니다.",
    memberAccess:
      "이 팀의 멤버만 팀 문서와 답변에 사용된 참고 문서를 볼 수 있습니다.",
    uploadComplete:
      "업로드 완료! 케찹이가 참고할 수 있도록 문서를 준비하고 있습니다.",
    folderProcessingStatus: "문서 준비 중",
  },
  folderUpload: {
    notice:
      "{teamName}에 추가한 문서는 팀 멤버가 함께 사용합니다. 케찹이는 답변할 때 이 문서를 참고할 수 있습니다.",
    doneDescription: "케찹이가 참고할 수 있도록 문서를 준비합니다.",
  },
  chat: {
    emptyTitle: "안녕하세요, 케찹이입니다.",
    emptyDescription:
      "팀에 추가된 문서를 참고해 질문에 답변하고, 참고한 문서도 함께 보여드립니다.",
  },
} as const;
