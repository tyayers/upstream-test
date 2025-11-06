SECONDS=0

gcloud builds submit --tag "$REGION-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/upstream" --project $PROJECT_ID

# gcloud run deploy upstream --image=$REGION-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/upstream --region=europe-west1 --project $PROJECT_ID
sed -i "/              value: DEPLOY_DATE_/c\              value: DEPLOY_DATE_$(date +%d-%m-%Y_%H-%M-%S)" cloudrun.yaml
gcloud run services replace cloudrun.yaml --project $PROJECT_ID --region $REGION

duration=$SECONDS
echo "Total deployment finished in $((duration / 60)) minutes and $((duration % 60)) seconds."
