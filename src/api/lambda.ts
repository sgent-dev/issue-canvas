/**
 * AWS Lambda ハンドラ(Function URL 経由、CloudFront の /api/* ビヘイビアから呼ばれる)。
 * ストアは S3(ISSUE_CANVAS_STORE=s3 / ISSUE_CANVAS_BUCKET は Terraform が環境変数で渡す)。
 */
import { handle } from "hono/aws-lambda";
import { createStoreFromEnv } from "../core/store-select.js";
import { createApp } from "./app.js";

const { store } = createStoreFromEnv();
export const handler = handle(createApp(store));
