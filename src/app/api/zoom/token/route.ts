import { NextRequest, NextResponse } from 'next/server';
import { KJUR } from 'jsrsasign';

export async function POST(req: NextRequest) {
  const { sessionName, role, userIdentity } = await req.json();

  if (!sessionName || role === undefined) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const sdkKey = process.env.NEXT_PUBLIC_ZOOM_VIDEO_SDK_KEY;
  const sdkSecret = process.env.ZOOM_VIDEO_SDK_SECRET;

  if (!sdkKey || !sdkSecret) {
    return NextResponse.json({ error: 'Zoom SDK credentials not configured' }, { status: 500 });
  }

  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 60 * 60 * 2; // 2시간

  const payload: Record<string, unknown> = {
    app_key: sdkKey,
    tpc: sessionName,
    role_type: role, // 0: 참여자, 1: 호스트
    version: 1,
    iat,
    exp,
  };

  if (userIdentity) {
    payload.user_identity = userIdentity;
  }

  const token = KJUR.jws.JWS.sign(
    'HS256',
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    JSON.stringify(payload),
    sdkSecret,
  );

  return NextResponse.json({ token });
}
