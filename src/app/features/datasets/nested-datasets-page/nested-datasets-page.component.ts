import {Component} from '@angular/core';
import {ProjectTypeEnum} from '@common/nested-project-view/nested-project-view-page/nested-project-view-page.component';
import {CircleTypeEnum} from '~/shared/constants/non-common-consts';
import {ProjectsSharedModule} from '~/features/projects/shared/projects-shared.module';
import {SMSharedModule} from '@common/shared/shared.module';
import {AsyncPipe, NgIf} from '@angular/common';
import {CommonProjectsPageComponent} from '@common/projects/containers/projects-page/common-projects-page.component';
import {DatasetEmptyComponent} from '@common/datasets/dataset-empty/dataset-empty.component';

@Component({
  selector: 'sm-nested-datasets-page',
  templateUrl: './nested-datasets-page.component.html',
  styleUrls: [
    '../../../webapp-common/nested-project-view/nested-project-view-page/nested-project-view-page.component.scss',
    '../../../webapp-common/datasets/simple-datasets/simple-datasets.component.scss'
  ],
  imports: [
    ProjectsSharedModule,
    SMSharedModule,
    AsyncPipe,
    NgIf
  ],
  standalone: true
})
export class NestedDatasetsPageComponent extends CommonProjectsPageComponent {
  entityTypeEnum = ProjectTypeEnum;
  circleTypeEnum = CircleTypeEnum;
  hideMenu = false;
  entityType = ProjectTypeEnum.datasets;

  projectCardClicked(data: { hasSubProjects: boolean; id: string; name: string }) {
    if (data.hasSubProjects) {
      this.router.navigate(['simple', data.id, 'projects'], {relativeTo: this.route.parent?.parent});
    } else {
      this.router.navigate(['simple', data.id, ProjectTypeEnum.datasets], {relativeTo: this.route.parent?.parent});
    }
  }

  createExamples() {
    this.dialog.open(DatasetEmptyComponent, {
      maxWidth: '95vw',
      width: '1248px'
    });
  }

  toggleNestedView(nested: boolean) {
    if (!nested) {
      this.router.navigateByUrl(this.entityType);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getExtraProjects(selectedProjectId, selectedProject) {
    return [];
  }

}
