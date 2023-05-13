import { BingChat } from "bing-chat";
import { config } from "../config";
import { queryGPT } from "./openAIUtils";

async function bingResponse(searchTerm: string) {
  try {
    const api = new BingChat({
      cookie: config.bingAiCookie,
    });

    const res = await api.sendMessage(`
        Look into web pages across the web for query:'${searchTerm}' and give me a summary of what you found, I want detailed summary from more than 5 sources`);
    console.log(res.text);
    return res.text;
  } catch (er) {
    console.log("Error in the bing ai response", er);
  }
}

export async function checkThroughBingAiChat(searchTerm: string, ctx: any) {
  try {
    const bingResult = bingResponse(searchTerm);
    const bingAiSearchSummary = await queryGPT(
      `Tell me if ${searchTerm} is currently true or false from the information given. If you are not sure or don't know, type NS i.e not sure. Also, tell why. Don't check for authenticity/announcement. 
    Your response should be in the following format: \n\nTrue/False/NS: Summary\n\n
    Information: \n\n${bingResult}\n\.`
    );
    ctx?.reply("Summary: " + bingAiSearchSummary);
    console.log("Summary:", bingAiSearchSummary);

    const result = bingAiSearchSummary?.toLowerCase();
    let resultNum = 3;
    if (result?.startsWith("true")) {
      resultNum = 1;
    } else if (result?.startsWith("false")) {
      resultNum = 2;
    }
    return resultNum;
  } catch (er) {
    console.log("Error in checking the bing ai response", er);
  }
}
