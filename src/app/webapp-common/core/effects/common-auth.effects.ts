import {Injectable} from '@angular/core';
import {Actions, createEffect, ofType} from '@ngrx/effects';
import {ApiAuthService} from '~/business-logic/api-services/auth.service';
import * as authActions from '../actions/common-auth.actions';
import {requestFailed} from '../actions/http.actions';
import {activeLoader, deactivateLoader, setServerError} from '../actions/layout.actions';
import {catchError, filter, finalize, map, mergeMap, switchMap, throttleTime, withLatestFrom} from 'rxjs/operators';
import {AuthGetCredentialsResponse} from '~/business-logic/model/auth/authGetCredentialsResponse';
import {select, Store} from '@ngrx/store';
import {selectCurrentUser} from '../reducers/users-reducer';
import {GetCurrentUserResponseUserObject} from '~/business-logic/model/users/getCurrentUserResponseUserObject';
import {AdminService} from '~/shared/services/admin.service';
import {selectDontShowAgainForBucketEndpoint, selectS3BucketCredentialsBucketCredentials, selectSignedUrl} from '@common/core/reducers/common-auth-reducer';
import {EMPTY, of} from 'rxjs';
import {S3AccessResolverComponent} from '@common/layout/s3-access-resolver/s3-access-resolver.component';
import {MatDialog} from '@angular/material/dialog';
import {setCredentialLabel} from '../actions/common-auth.actions';
import {SignResponse} from '@common/settings/admin/base-admin-utils';

@Injectable()
export class CommonAuthEffects {
  private signAfterPopup: (ReturnType<typeof authActions.getSignedUrl>)[] = [];
  private openPopup: { [bucketName: string]: boolean } = {};

  constructor(
    private actions: Actions,
    private credentialsApi: ApiAuthService,
    private store: Store,
    private adminService: AdminService,
    private matDialog: MatDialog
  ) {}

  activeLoader = createEffect(() => this.actions.pipe(
    ofType(authActions.getAllCredentials, authActions.createCredential),
    map(action => activeLoader(action.type))
  ));

  getAllCredentialsEffect = createEffect(() => this.actions.pipe(
    ofType(authActions.getAllCredentials),
    switchMap(action => this.credentialsApi.authGetCredentials({}).pipe(
      withLatestFrom(this.store.select(selectCurrentUser)),
      mergeMap(([res, user]: [AuthGetCredentialsResponse, GetCurrentUserResponseUserObject]) => [
        authActions.updateAllCredentials({credentials: res.credentials, extra: res?.['additional_credentials'], workspace: user.company.id}),
        deactivateLoader(action.type)
      ]),
      catchError(error => [requestFailed(error), deactivateLoader(action.type)])
    ))
  ));

  revokeCredential = createEffect(() => this.actions.pipe(
    ofType(authActions.credentialRevoked),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    mergeMap(action => this.credentialsApi.authRevokeCredentials({access_key: action.accessKey}).pipe(
      mergeMap(() => [authActions.removeCredential(action), deactivateLoader(action.type)]),
      catchError(error => [
        requestFailed(error),
        deactivateLoader(action.type),
        setServerError(error, null, `Can't delete this credentials.`)
      ])
    ))
  ));

  createCredential = createEffect(() => this.actions.pipe(
    ofType(authActions.createCredential),
    mergeMap(action => this.credentialsApi.authCreateCredentials({label: action.label}).pipe(
      mergeMap(({credentials}) => [
        authActions.addCredential({newCredential: credentials, workspaceId: action.workspace?.id}),
        deactivateLoader(action.type)
      ]),
      catchError(error => [
        requestFailed(error),
        setServerError(error, null, 'Unable to create credentials'),
        authActions.addCredential({newCredential: {}, workspaceId: action.workspace?.id}),
        deactivateLoader(action.type)])
    ))
  ));

  updateCredentialLabel = createEffect(() => this.actions.pipe(
    ofType(authActions.updateCredentialLabel),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    mergeMap(action => this.credentialsApi.authEditCredentials({access_key: action.credential.access_key, label: action.label}).pipe(
      mergeMap(() => [
        setCredentialLabel({credential: action.credential, label: action.label}),
        deactivateLoader(action.type)
      ]),
      catchError(error => [
        requestFailed(error),
        setServerError(error, null, 'Unable to update credentials'),
        deactivateLoader(action.type)])
    ))
  ));

  refresh = createEffect(() => this.actions.pipe(
    ofType(authActions.refreshS3Credential, authActions.getSignedUrl),
    map(() => {
      const state = JSON.parse(window.localStorage.getItem('_saved_state_'));
      return authActions.setS3Credentials({bucketCredentials: state?.auth?.s3BucketCredentials?.bucketCredentials});
    })
  ));

  signUrl = createEffect(() => this.actions.pipe(
    ofType(authActions.getSignedUrl),
    filter(action => !!action.url),
    mergeMap(action =>
      of(action).pipe(
        withLatestFrom(
          this.store.select(state => selectSignedUrl(action.url)(state))
        ),
        switchMap(([, signedUrl]) =>
          (!signedUrl?.expires || signedUrl.expires < (new Date()).getTime() || action.config?.disableCache) ?
            this.adminService.signUrlIfNeeded(action.url, action.config) : of({type: 'none'})
        ),
        filter(res => !!res),
        switchMap((res: SignResponse) => {
            switch (res.type) {
              case 'popup':
                this.signAfterPopup.push(action);
                return [authActions.showS3PopUp({credentials: res.bucket, isAzure: res.azure, credentialsError: null})];
              case 'sign':
                return [authActions.setSignedUrl({url: action.url, signed: res.signed, expires: res.expires})];
              default:
                return EMPTY;
            }
          }
        ),
      ),
    )
  ));

  s3popup = createEffect(() => this.actions.pipe(
    ofType(authActions.showS3PopUp),
    withLatestFrom(
      this.store.select(selectDontShowAgainForBucketEndpoint)
    ),
    throttleTime(500),
    filter(([action, dontShowAgain]) =>
      action?.credentials?.Bucket + action?.credentials?.Endpoint !== dontShowAgain &&
      !this.openPopup[action?.credentials?.Bucket]
    ),
    switchMap(([action]) => {
      if (action?.credentials?.Bucket) {
        this.openPopup[action.credentials.Bucket] = true;
      }
      return this.matDialog.open(S3AccessResolverComponent, {data: action, maxWidth: 700}).afterClosed().pipe(
        withLatestFrom(
          this.store.pipe(select(selectS3BucketCredentialsBucketCredentials)),
        ),
        switchMap(([data, bucketCredentials]) => {
          window.setTimeout(() => this.signAfterPopup = []);
          if (data) {
            if (!data.success) {
              const emptyCredentials = bucketCredentials.find((cred => cred?.Bucket === data.bucket)) === undefined;
              const dontAskAgainForBucketName = emptyCredentials ? '' : data.bucket + data.endpoint;
              return [authActions.cancelS3Credentials({dontAskAgainForBucketName})];
            }
            return [authActions.saveS3Credentials({newCredential: data}), ...this.signAfterPopup];
          }
          return [...this.signAfterPopup];
        }),
        finalize(() => action?.credentials?.Bucket && delete this.openPopup[action.credentials.Bucket])
      );
    })
  ));
}
